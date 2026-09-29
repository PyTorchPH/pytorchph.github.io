//! Sign-in with a Google ID token from the portal's Google button.
//!
//! Module map (caller-first):
//!   google_login              POST /auth/google
//!   ├─ verify_google          proves the token was issued by Google for this client
//!   │   ├─ read_rs256_key_id  checks the token header and names its signing key
//!   │   ├─ google_keys        Google's signing keys, cached for an hour
//!   │   └─ is_trusted_identity
//!   ├─ link_member            creates or updates the member for the verified email
//!   └─ load_viewer            reads back the member to start a session
use crate::{
    ApiError, ApiResult, AppState, check_origin,
    identity::session::{Viewer, issue_session},
    internal,
};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Response,
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::Deserialize;
use sqlx::{Row, SqlitePool};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use uuid::Uuid;

const GOOGLE_CERTS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS: [&str; 2] = ["https://accounts.google.com", "accounts.google.com"];
const KEY_CACHE: Duration = Duration::from_secs(3600);
const MAX_TOKEN_LENGTH: usize = 8192;
const MAX_EMAIL_LENGTH: usize = 320;
const MAX_DISPLAY_NAME: usize = 100;

#[derive(Deserialize)]
pub struct Login {
    id_token: String,
}

#[derive(Deserialize)]
struct GoogleClaims {
    sub: String,
    email: String,
    email_verified: bool,
    name: Option<String>,
}

/// Mental model: trust the token only after Google's signature checks out, then attach the
/// Google identity to exactly one member and start a session for them.
pub async fn google_login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<Login>,
) -> ApiResult<Response> {
    check_origin(&state, &headers)?;
    let claims = verify_google(&state, &payload.id_token).await?;
    let email = claims.email.to_ascii_lowercase();
    link_member(&state, &claims, &email).await?;
    let viewer = load_viewer(&state.db, &email).await?;
    issue_session(&state, viewer).await
}

/// Mental model: header says RS256 + which key → fetch that key → signature, audience and
/// issuer must all match → the email itself must be verified.
async fn verify_google(state: &AppState, token: &str) -> ApiResult<GoogleClaims> {
    if token.len() > MAX_TOKEN_LENGTH {
        return Err(invalid_token());
    }
    let kid = read_rs256_key_id(token)?;
    let keys = google_keys(state).await?;
    let key = keys
        .find(&kid)
        .ok_or(ApiError(StatusCode::UNAUTHORIZED, "Unknown Google key"))?;
    let key = DecodingKey::from_jwk(key).map_err(internal)?;
    let claims = decode::<GoogleClaims>(token, &key, &google_validation(state))
        .map_err(|_| invalid_token())?
        .claims;
    if !is_trusted_identity(&claims) {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Unverified Google identity",
        ));
    }
    Ok(claims)
}

fn read_rs256_key_id(token: &str) -> ApiResult<String> {
    let header = decode_header(token).map_err(|_| invalid_token())?;
    if header.alg != Algorithm::RS256 {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Invalid Google algorithm",
        ));
    }
    header
        .kid
        .ok_or(ApiError(StatusCode::UNAUTHORIZED, "Missing key id"))
}

async fn google_keys(state: &AppState) -> ApiResult<JwkSet> {
    let mut guard = state.google_keys.lock().await;
    if let Some((fetched, keys)) = &*guard
        && is_fresh(*fetched)
    {
        return Ok(keys.clone());
    }
    let keys: JwkSet = state
        .http
        .get(GOOGLE_CERTS_URL)
        .send()
        .await
        .map_err(internal)?
        .error_for_status()
        .map_err(internal)?
        .json()
        .await
        .map_err(internal)?;
    *guard = Some((Instant::now(), keys.clone()));
    Ok(keys)
}

fn google_validation(state: &AppState) -> Validation {
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[state.google_client_id.as_str()]);
    validation.set_issuer(&GOOGLE_ISSUERS);
    validation
}

/// Mental model: an email already claimed by email sign-up gets Google linked to it; the
/// same Google account just refreshes its name; a different Google account is refused.
async fn link_member(state: &AppState, claims: &GoogleClaims, email: &str) -> ApiResult<()> {
    let display_name = display_name_for(claims, email);
    let existing: Option<String> =
        sqlx::query_scalar("SELECT google_sub FROM members WHERE email = ?")
            .bind(email)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    match existing {
        Some(sub) if is_email_signup_identity(&sub) => {
            sqlx::query("UPDATE members SET google_sub = ?, display_name = ? WHERE email = ?")
                .bind(&claims.sub)
                .bind(&display_name)
                .bind(email)
                .execute(&state.db)
                .await
                .map_err(internal)?;
        }
        Some(sub) if sub == claims.sub => {
            sqlx::query("UPDATE members SET display_name = ? WHERE email = ?")
                .bind(&display_name)
                .bind(email)
                .execute(&state.db)
                .await
                .map_err(internal)?;
        }
        Some(_) => {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Email belongs to another identity",
            ));
        }
        None => create_member(state, claims, email, &display_name).await?,
    }
    Ok(())
}

// Every new account is a member at once; the configured bootstrap email becomes admin.
// Officer roles are granted separately.
async fn create_member(
    state: &AppState,
    claims: &GoogleClaims,
    email: &str,
    display_name: &str,
) -> ApiResult<()> {
    let id = Uuid::new_v4().to_string();
    let role = initial_role(state, email);
    sqlx::query("INSERT INTO members(id, google_sub, email, display_name, public_handle, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, display_name = excluded.display_name")
        .bind(&id).bind(&claims.sub).bind(email).bind(display_name)
        .bind(format!("Member-{}", &id[..8])).bind(role).bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db).await.map_err(internal)?;
    Ok(())
}

async fn load_viewer(db: &SqlitePool, email: &str) -> ApiResult<Viewer> {
    let row = sqlx::query("SELECT id, display_name, role FROM members WHERE email = ?")
        .bind(email)
        .fetch_one(db)
        .await
        .map_err(internal)?;
    Ok(Viewer {
        id: row.get(0),
        display_name: row.get(1),
        role: row.get(2),
    })
}

#[inline]
fn is_fresh(fetched: Instant) -> bool {
    fetched.elapsed() < KEY_CACHE
}

#[inline]
fn is_trusted_identity(claims: &GoogleClaims) -> bool {
    claims.email_verified && !claims.sub.is_empty() && claims.email.len() <= MAX_EMAIL_LENGTH
}

#[inline]
fn is_email_signup_identity(google_sub: &str) -> bool {
    google_sub.starts_with("email:")
}

#[inline]
fn initial_role(state: &AppState, email: &str) -> &'static str {
    if email == state.bootstrap_admin_email.to_ascii_lowercase() {
        "admin"
    } else {
        "member"
    }
}

#[inline]
fn display_name_for(claims: &GoogleClaims, email: &str) -> String {
    claims
        .name
        .clone()
        .unwrap_or_else(|| email.to_owned())
        .chars()
        .take(MAX_DISPLAY_NAME)
        .collect()
}

#[inline]
fn invalid_token() -> ApiError {
    ApiError(StatusCode::UNAUTHORIZED, "Invalid Google token")
}
