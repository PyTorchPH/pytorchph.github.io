use crate::{
    ApiError, ApiResult, AppState,
    auth::{Viewer, issue_session},
    check_origin, internal,
};
use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Response,
};
use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::{env, sync::Arc};
use subtle::ConstantTimeEq;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;
const GENERIC_SENT: &str = "If this address can register, a verification code has been sent.";

pub struct RelayConfig {
    url: url::Url,
    token: String,
}

#[cfg(test)]
mod relay_tests {
    use super::*;
    use axum::{Router, routing::post};

    #[tokio::test]
    async fn relay_requires_json_acceptance_and_sends_private_bearer_auth() {
        let router = Router::new().route(
            "/send",
            post(
                |headers: HeaderMap, Json(body): Json<serde_json::Value>| async move {
                    assert_eq!(
                        headers.get("authorization").unwrap(),
                        "Bearer private-test-token"
                    );
                    assert_eq!(body["to"], "member@example.test");
                    Json(serde_json::json!({"accepted": true}))
                },
            ),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/send", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let relay = RelayConfig {
            url: url.parse().unwrap(),
            token: "private-test-token".into(),
        };
        assert!(
            relay
                .send_code(&reqwest::Client::new(), "member@example.test", "12345678")
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn relay_rejects_negative_json_acknowledgement() {
        let router = Router::new().route(
            "/send",
            post(|| async { Json(serde_json::json!({"accepted": false})) }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/send", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let relay = RelayConfig {
            url: url.parse().unwrap(),
            token: "private-test-token".into(),
        };
        assert_eq!(
            relay
                .send_code(&reqwest::Client::new(), "member@example.test", "12345678")
                .await,
            Err("relay_not_accepted")
        );
    }
}

#[derive(Deserialize)]
struct RelayAck {
    accepted: bool,
}

impl RelayConfig {
    pub fn from_env() -> Result<Option<Self>, Box<dyn std::error::Error>> {
        let (Ok(raw_url), Ok(token)) = (env::var("MAIL_RELAY_URL"), env::var("MAIL_RELAY_TOKEN"))
        else {
            if env::var_os("MAIL_RELAY_URL").is_some() || env::var_os("MAIL_RELAY_TOKEN").is_some()
            {
                return Err(
                    "MAIL_RELAY_URL and MAIL_RELAY_TOKEN must be configured together".into(),
                );
            }
            return Ok(None);
        };
        let url = url::Url::parse(&raw_url)?;
        if url.scheme() != "https"
            || url.host().is_none()
            || url.port().is_some_and(|port| port != 443)
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || token.is_empty()
        {
            return Err("Invalid HTTPS mail relay configuration".into());
        }
        Ok(Some(Self { url, token }))
    }

    async fn send_code(
        &self,
        http: &reqwest::Client,
        to: &str,
        code: &str,
    ) -> Result<(), &'static str> {
        let response = http.post(self.url.clone()).bearer_auth(&self.token)
            .json(&serde_json::json!({
                "to": to,
                "subject": "PyTorch PH verification code",
                "text": format!("Your PyTorch PH verification code is {code}. It expires in 10 minutes. If you did not request this, ignore this email."),
            }))
            .send().await.map_err(|_| "relay_transport_failure")?;
        if !response.status().is_success() {
            tracing::warn!(event = "auth.mail_relay_rejected", status = %response.status(), "Mail relay returned non-success status");
            return Err("relay_http_status");
        }
        let mut response = response;
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "relay_body_failure")? {
            if body.len() + chunk.len() > 4096 {
                return Err("relay_body_too_large");
            }
            body.extend_from_slice(&chunk);
        }
        let ack: RelayAck = serde_json::from_slice(&body).map_err(|_| "relay_invalid_json")?;
        if !ack.accepted {
            return Err("relay_not_accepted");
        }
        Ok(())
    }
}

fn normalize_email(raw: &str) -> Option<String> {
    let email = raw.trim().to_ascii_lowercase();
    if email.len() > 254 || email.len() < 5 || email.contains(char::is_whitespace) {
        return None;
    }
    let (local, domain) = email.split_once('@')?;
    if local.is_empty()
        || domain.len() < 3
        || !domain.contains('.')
        || domain.starts_with('.')
        || domain.ends_with('.')
    {
        return None;
    }
    Some(email)
}

pub(crate) fn password_hash(password: &str) -> ApiResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|value| value.to_string())
        .map_err(internal)
}

pub(crate) fn code_hash(secret: &str, email: &str, code: &str) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(email.as_bytes());
    mac.update(b":");
    mac.update(code.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

async fn limit(db: &SqlitePool, scope: &str, email: &str, maximum: i64) -> ApiResult<()> {
    let subject = hex::encode(Sha256::digest(email.as_bytes()));
    let cutoff = (Utc::now() - Duration::minutes(15)).to_rfc3339();
    let now = Utc::now().to_rfc3339();
    let attempts: i64 = sqlx::query_scalar("INSERT INTO auth_rate_limits(scope,subject_hash,window_started_at,attempts) VALUES (?,?,?,1) ON CONFLICT(scope,subject_hash) DO UPDATE SET attempts=CASE WHEN window_started_at < ? THEN 1 ELSE attempts+1 END,window_started_at=CASE WHEN window_started_at < ? THEN excluded.window_started_at ELSE window_started_at END RETURNING attempts")
        .bind(scope).bind(subject).bind(now).bind(&cutoff).bind(&cutoff)
        .fetch_one(db).await.map_err(internal)?;
    if attempts > maximum {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts. Try again later.",
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct SignupStart {
    email: String,
    password: String,
    name: String,
    username: String,
}

pub async fn start_signup(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<SignupStart>,
) -> ApiResult<Json<serde_json::Value>> {
    check_origin(&state, &headers)?;
    let email = normalize_email(&input.email)
        .ok_or(ApiError(StatusCode::BAD_REQUEST, "Invalid email address"))?;
    if input.password.len() < 8
        || input.password.len() > 1024
        || input.name.trim().len() < 2
        || input.name.len() > 100
        || input.username.len() < 3
        || input.username.len() > 24
        || !input
            .username
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Invalid registration details",
        ));
    }
    limit(&state.db, "signup_global", "all", 100).await?;
    limit(&state.db, "signup", &email, 3).await?;
    if sqlx::query_scalar::<_, i64>("SELECT 1 FROM members WHERE email=?")
        .bind(&email)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?
        .is_some()
    {
        return Ok(Json(serde_json::json!({"message": GENERIC_SENT})));
    }
    let relay = state.mail_relay.as_ref().ok_or(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Email verification is unavailable",
    ))?;
    let _slot = state.password_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Authentication is busy. Try again.",
        )
    })?;
    let password = input.password;
    let hash = tokio::task::spawn_blocking(move || password_hash(&password))
        .await
        .map_err(internal)??;
    let code = format!("{:08}", Uuid::new_v4().as_u128() % 100_000_000);
    let digest = code_hash(&state.email_code_secret, &email, &code);
    let now = Utc::now();
    sqlx::query("INSERT INTO pending_email_signups(email,display_name,public_handle,password_hash,code_hash,expires_at,sent_at,attempts) VALUES (?,?,?,?,?,?,?,0) ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,public_handle=excluded.public_handle,password_hash=excluded.password_hash,code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0")
        .bind(&email).bind(input.name.trim()).bind(&input.username).bind(hash).bind(digest)
        .bind((now + Duration::minutes(10)).to_rfc3339()).bind(now.to_rfc3339())
        .execute(&state.db).await.map_err(internal)?;
    if let Err(error) = relay.send_code(&state.http, &email, &code).await {
        sqlx::query("DELETE FROM pending_email_signups WHERE email=?")
            .bind(&email)
            .execute(&state.db)
            .await
            .map_err(internal)?;
        tracing::error!(event = "auth.email_delivery_failed", component = "auth", operation = "signup_start", outcome = "failure", error = %error, "Verification mail delivery failed");
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "Email verification is unavailable",
        ));
    }
    tracing::info!(
        event = "auth.verification_code_sent",
        component = "auth",
        operation = "signup_start",
        outcome = "success",
        "Verification mail accepted by relay"
    );
    Ok(Json(serde_json::json!({"message": GENERIC_SENT})))
}

#[derive(Deserialize)]
pub struct SignupVerify {
    pub(crate) email: String,
    pub(crate) code: String,
}

pub async fn verify_signup(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<SignupVerify>,
) -> ApiResult<Response> {
    check_origin(&state, &headers)?;
    let email = normalize_email(&input.email).ok_or(ApiError(
        StatusCode::BAD_REQUEST,
        "Invalid verification code",
    ))?;
    limit(&state.db, "verify", &email, 8).await?;
    if input.code.len() != 8 || !input.code.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Invalid verification code",
        ));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    let row = sqlx::query("SELECT display_name,public_handle,password_hash,code_hash,expires_at,attempts FROM pending_email_signups WHERE email=?")
        .bind(&email).fetch_optional(&mut *tx).await.map_err(internal)?
        .ok_or(ApiError(StatusCode::BAD_REQUEST, "Invalid verification code"))?;
    let expected = code_hash(&state.email_code_secret, &email, &input.code);
    let stored: String = row.get("code_hash");
    let expires: String = row.get("expires_at");
    let attempts: i64 = row.get("attempts");
    if attempts >= 5
        || expires <= Utc::now().to_rfc3339()
        || !bool::from(expected.as_bytes().ct_eq(stored.as_bytes()))
    {
        sqlx::query("UPDATE pending_email_signups SET attempts=attempts+1 WHERE email=?")
            .bind(&email)
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
        tx.commit().await.map_err(internal)?;
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Invalid verification code",
        ));
    }
    let id = Uuid::new_v4().to_string();
    let name: String = row.get("display_name");
    let handle: String = row.get("public_handle");
    let hash: String = row.get("password_hash");
    sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,'member',?)")
        .bind(&id).bind(format!("email:{id}")).bind(&email).bind(&name).bind(&handle).bind(Utc::now().to_rfc3339())
        .execute(&mut *tx).await.map_err(|_| ApiError(StatusCode::CONFLICT, "Account or username already exists"))?;
    sqlx::query(
        "INSERT INTO email_credentials(member_id,password_hash,verified_at) VALUES (?,?,?)",
    )
    .bind(&id)
    .bind(hash)
    .bind(Utc::now().to_rfc3339())
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    sqlx::query("DELETE FROM pending_email_signups WHERE email=?")
        .bind(&email)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(event = "auth.email_verified", component = "auth", operation = "signup_verify", outcome = "success", member_id = %id, "Email account created");
    issue_session(
        &state,
        Viewer {
            id,
            display_name: name,
            role: "member".into(),
        },
    )
    .await
}

#[derive(Deserialize)]
pub struct PasswordLogin {
    pub(crate) email: String,
    pub(crate) password: String,
}

pub async fn password_login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<PasswordLogin>,
) -> ApiResult<Response> {
    check_origin(&state, &headers)?;
    let email = normalize_email(&input.email).ok_or(ApiError(
        StatusCode::UNAUTHORIZED,
        "Invalid email or password",
    ))?;
    if input.password.is_empty() || input.password.len() > 1024 {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Invalid email or password",
        ));
    }
    limit(&state.db, "login_global", "all", 500).await?;
    limit(&state.db, "login", &email, 15).await?;
    let row = sqlx::query("SELECT m.id,m.display_name,m.role,c.password_hash FROM members m JOIN email_credentials c ON c.member_id=m.id WHERE m.email=?")
        .bind(email).fetch_optional(&state.db).await.map_err(internal)?;
    let Some(row) = row else {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Invalid email or password",
        ));
    };
    let hash: String = row.get("password_hash");
    let _slot = state.password_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Authentication is busy. Try again.",
        )
    })?;
    let password = input.password;
    let valid = tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash).ok().is_some_and(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
    })
    .await
    .map_err(internal)?;
    if !valid {
        tracing::warn!(
            event = "auth.password_rejected",
            component = "auth",
            operation = "password_login",
            outcome = "failure",
            "Password rejected"
        );
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Invalid email or password",
        ));
    }
    let viewer = Viewer {
        id: row.get("id"),
        display_name: row.get("display_name"),
        role: row.get("role"),
    };
    tracing::info!(event = "auth.password_accepted", component = "auth", operation = "password_login", outcome = "success", member_id = %viewer.id, "Password accepted");
    issue_session(&state, viewer).await
}

pub async fn seed_test_accounts(
    db: &SqlitePool,
    password: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    for (email, role, handle) in [
        ("member@admin.ph", "member", "TestMember"),
        ("officer@admin.ph", "officer", "TestOfficer"),
    ] {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT OR IGNORE INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,?,?)")
            .bind(&id).bind(format!("email:{id}")).bind(email).bind(handle).bind(handle).bind(role).bind(Utc::now().to_rfc3339())
            .execute(db).await?;
        if role == "officer" {
            sqlx::query("UPDATE members SET role='officer' WHERE email=?")
                .bind(email)
                .execute(db)
                .await?;
        }
        let hash = password_hash(password).map_err(|_| "password hashing failed")?;
        sqlx::query("INSERT INTO email_credentials(member_id,password_hash,verified_at) SELECT id,?,? FROM members WHERE email=? ON CONFLICT(member_id) DO NOTHING")
            .bind(hash).bind(Utc::now().to_rfc3339()).bind(email).execute(db).await?;
    }
    tracing::warn!(
        event = "auth.temporary_test_accounts_enabled",
        component = "auth",
        operation = "test_seed",
        outcome = "success",
        "Temporary test accounts seeded"
    );
    Ok(())
}
