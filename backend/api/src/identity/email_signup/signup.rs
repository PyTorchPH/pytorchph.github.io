//! Email sign-up: send a one-time code, then turn a verified code into a member account.
//!
//! Module map (caller-first):
//!   start_signup                 POST /auth/email/start
//!   ├─ is_valid_registration     password, name and username bounds
//!   ├─ email_already_registered  existing members get the same generic reply
//!   ├─ store_pending_signup      hashed password + hashed code, valid for 10 minutes
//!   └─ deliver_or_withdraw       sends the code; withdraws the pending row if delivery fails
//!   verify_signup                POST /auth/email/verify
//!   ├─ is_rejected_code          too many attempts, expired, or not matching
//!   ├─ record_failed_attempt
//!   └─ create_email_member       member + credentials, pending row removed
use super::credentials::{
    claim_hashing_slot, code_hash, enforce_rate_limit, is_eight_digit_code, normalize_email,
    password_hash,
};
use super::password_policy::{PASSWORD_POLICY, meets_password_policy};
use super::relay::RelayConfig;
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
use chrono::{Duration, Utc};
use serde::Deserialize;
use sqlx::{Row, Sqlite, SqlitePool, Transaction, sqlite::SqliteRow};
use std::sync::Arc;
use subtle::ConstantTimeEq;
use uuid::Uuid;

const GENERIC_SENT: &str = "If this address can register, a verification code has been sent.";
const CODE_LIFETIME_MINUTES: i64 = 10;
const MAX_CODE_ATTEMPTS: i64 = 5;
const SIGNUPS_PER_WINDOW: i64 = 100;
const SIGNUPS_PER_EMAIL: i64 = 3;
const VERIFICATIONS_PER_EMAIL: i64 = 8;

#[derive(Deserialize)]
pub struct SignupStart {
    email: String,
    password: String,
    name: String,
    username: String,
}

#[derive(Deserialize)]
pub struct SignupVerify {
    pub(crate) email: String,
    pub(crate) code: String,
}

/// Mental model: validate → rate-limit → answer registered addresses with the same generic
/// message (no account enumeration) → store a pending sign-up → email the code.
pub async fn start_signup(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<SignupStart>,
) -> ApiResult<Json<serde_json::Value>> {
    check_origin(&state, &headers)?;
    let email = normalize_email(&input.email)
        .ok_or(ApiError(StatusCode::BAD_REQUEST, "Invalid email address"))?;
    if !meets_password_policy(&input.password) {
        return Err(ApiError(StatusCode::BAD_REQUEST, PASSWORD_POLICY));
    }
    if !is_valid_registration(&input) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Invalid registration details",
        ));
    }
    enforce_rate_limit(&state.db, "signup_global", "all", SIGNUPS_PER_WINDOW).await?;
    enforce_rate_limit(&state.db, "signup", &email, SIGNUPS_PER_EMAIL).await?;
    if email_already_registered(&state.db, &email).await? {
        return Ok(generic_sent());
    }
    let relay = state
        .mail_relay
        .as_ref()
        .ok_or(verification_unavailable())?;
    let _slot = claim_hashing_slot(&state)?;
    let code = new_verification_code();
    store_pending_signup(&state, &email, input, &code).await?;
    deliver_or_withdraw(&state, relay, &email, &code).await?;
    tracing::info!(
        event = "auth.verification_code_sent",
        component = "auth",
        operation = "signup_start",
        outcome = "success",
        "Verification mail accepted by relay"
    );
    Ok(generic_sent())
}

#[inline]
fn is_valid_registration(input: &SignupStart) -> bool {
    meets_password_policy(&input.password)
        && input.name.trim().len() >= 2
        && input.name.len() <= 100
        && (3..=24).contains(&input.username.len())
        && input
            .username
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

async fn email_already_registered(db: &SqlitePool, email: &str) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT 1 FROM members WHERE email=?")
            .bind(email)
            .fetch_optional(db)
            .await
            .map_err(internal)?
            .is_some(),
    )
}

async fn store_pending_signup(
    state: &AppState,
    email: &str,
    input: SignupStart,
    code: &str,
) -> ApiResult<()> {
    let password = input.password;
    let hash = tokio::task::spawn_blocking(move || password_hash(&password))
        .await
        .map_err(internal)??;
    let digest = code_hash(&state.email_code_secret, email, code);
    let now = Utc::now();
    sqlx::query("INSERT INTO pending_email_signups(email,display_name,public_handle,password_hash,code_hash,expires_at,sent_at,attempts) VALUES (?,?,?,?,?,?,?,0) ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,public_handle=excluded.public_handle,password_hash=excluded.password_hash,code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0")
        .bind(email).bind(input.name.trim()).bind(&input.username).bind(hash).bind(digest)
        .bind((now + Duration::minutes(CODE_LIFETIME_MINUTES)).to_rfc3339()).bind(now.to_rfc3339())
        .execute(&state.db).await.map_err(internal)?;
    Ok(())
}

async fn deliver_or_withdraw(
    state: &AppState,
    relay: &RelayConfig,
    email: &str,
    code: &str,
) -> ApiResult<()> {
    let Err(error) = relay.send_code(&state.http, email, code).await else {
        return Ok(());
    };
    sqlx::query("DELETE FROM pending_email_signups WHERE email=?")
        .bind(email)
        .execute(&state.db)
        .await
        .map_err(internal)?;
    tracing::error!(event = "auth.email_delivery_failed", component = "auth", operation = "signup_start", outcome = "failure", error = %error, "Verification mail delivery failed");
    Err(verification_unavailable())
}

/// Mental model: the code is checked inside one transaction; a wrong, stale or over-tried code
/// only bumps the attempt counter, a right one creates the member and signs them in.
pub async fn verify_signup(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<SignupVerify>,
) -> ApiResult<Response> {
    check_origin(&state, &headers)?;
    let email = normalize_email(&input.email).ok_or(invalid_code())?;
    enforce_rate_limit(&state.db, "verify", &email, VERIFICATIONS_PER_EMAIL).await?;
    if !is_eight_digit_code(&input.code) {
        return Err(invalid_code());
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    let pending = sqlx::query("SELECT display_name,public_handle,password_hash,code_hash,expires_at,attempts FROM pending_email_signups WHERE email=?")
        .bind(&email).fetch_optional(&mut *tx).await.map_err(internal)?
        .ok_or(invalid_code())?;
    if is_rejected_code(&state, &pending, &email, &input.code) {
        record_failed_attempt(&mut tx, &email).await?;
        tx.commit().await.map_err(internal)?;
        return Err(invalid_code());
    }
    let viewer = create_email_member(&mut tx, &pending, &email).await?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(event = "auth.email_verified", component = "auth", operation = "signup_verify", outcome = "success", member_id = %viewer.id, "Email account created");
    issue_session(&state, viewer).await
}

#[inline]
fn is_rejected_code(state: &AppState, pending: &SqliteRow, email: &str, code: &str) -> bool {
    let expected = code_hash(&state.email_code_secret, email, code);
    let stored: String = pending.get("code_hash");
    let expires: String = pending.get("expires_at");
    let attempts: i64 = pending.get("attempts");
    attempts >= MAX_CODE_ATTEMPTS
        || expires <= Utc::now().to_rfc3339()
        || !bool::from(expected.as_bytes().ct_eq(stored.as_bytes()))
}

async fn record_failed_attempt(tx: &mut Transaction<'_, Sqlite>, email: &str) -> ApiResult<()> {
    sqlx::query("UPDATE pending_email_signups SET attempts=attempts+1 WHERE email=?")
        .bind(email)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}

async fn create_email_member(
    tx: &mut Transaction<'_, Sqlite>,
    pending: &SqliteRow,
    email: &str,
) -> ApiResult<Viewer> {
    let id = Uuid::new_v4().to_string();
    let name: String = pending.get("display_name");
    let handle: String = pending.get("public_handle");
    let hash: String = pending.get("password_hash");
    sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,'member',?)")
        .bind(&id).bind(format!("email:{id}")).bind(email).bind(&name).bind(&handle).bind(Utc::now().to_rfc3339())
        .execute(&mut **tx).await.map_err(|_| ApiError(StatusCode::CONFLICT, "Account or username already exists"))?;
    sqlx::query(
        "INSERT INTO email_credentials(member_id,password_hash,verified_at) VALUES (?,?,?)",
    )
    .bind(&id)
    .bind(hash)
    .bind(Utc::now().to_rfc3339())
    .execute(&mut **tx)
    .await
    .map_err(internal)?;
    sqlx::query("DELETE FROM pending_email_signups WHERE email=?")
        .bind(email)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(Viewer {
        id,
        display_name: name,
        role: "member".into(),
    })
}

#[inline]
fn new_verification_code() -> String {
    format!("{:08}", Uuid::new_v4().as_u128() % 100_000_000)
}

#[inline]
fn generic_sent() -> Json<serde_json::Value> {
    Json(serde_json::json!({"message": GENERIC_SENT}))
}

#[inline]
fn verification_unavailable() -> ApiError {
    ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Email verification is unavailable",
    )
}

#[inline]
fn invalid_code() -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, "Invalid verification code")
}
