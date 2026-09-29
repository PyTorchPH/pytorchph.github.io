//! Password sign-in for email accounts.
//!
//! Module map (caller-first):
//!   password_login        POST /auth/password
//!   ├─ is_acceptable_password_input
//!   ├─ load_credentials   member + stored hash for the email, if any
//!   └─ check_password     Argon2 verification off the async runtime
use super::credentials::{
    claim_hashing_slot, enforce_rate_limit, normalize_email, verify_password,
};
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
use serde::Deserialize;
use sqlx::{Row, SqlitePool, sqlite::SqliteRow};
use std::sync::Arc;

const MAX_PASSWORD_LENGTH: usize = 1024;
const LOGINS_PER_WINDOW: i64 = 500;
const LOGINS_PER_EMAIL: i64 = 15;

#[derive(Deserialize)]
pub struct PasswordLogin {
    pub(crate) email: String,
    pub(crate) password: String,
}

/// Mental model: every failure — bad input, unknown email, wrong password — gives the same
/// "Invalid email or password" so the reply never reveals which accounts exist.
pub async fn password_login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<PasswordLogin>,
) -> ApiResult<Response> {
    check_origin(&state, &headers)?;
    let email = normalize_email(&input.email).ok_or(invalid_credentials())?;
    if !is_acceptable_password_input(&input.password) {
        return Err(invalid_credentials());
    }
    enforce_rate_limit(&state.db, "login_global", "all", LOGINS_PER_WINDOW).await?;
    enforce_rate_limit(&state.db, "login", &email, LOGINS_PER_EMAIL).await?;
    let credentials = load_credentials(&state.db, email)
        .await?
        .ok_or(invalid_credentials())?;
    let hash: String = credentials.get("password_hash");
    let _slot = claim_hashing_slot(&state)?;
    if !check_password(hash, input.password).await? {
        tracing::warn!(
            event = "auth.password_rejected",
            component = "auth",
            operation = "password_login",
            outcome = "failure",
            "Password rejected"
        );
        return Err(invalid_credentials());
    }
    let viewer = Viewer {
        id: credentials.get("id"),
        display_name: credentials.get("display_name"),
        role: credentials.get("role"),
    };
    tracing::info!(event = "auth.password_accepted", component = "auth", operation = "password_login", outcome = "success", member_id = %viewer.id, "Password accepted");
    issue_session(&state, viewer).await
}

#[inline]
fn is_acceptable_password_input(password: &str) -> bool {
    !password.is_empty() && password.len() <= MAX_PASSWORD_LENGTH
}

async fn load_credentials(db: &SqlitePool, email: String) -> ApiResult<Option<SqliteRow>> {
    sqlx::query("SELECT m.id,m.display_name,m.role,c.password_hash FROM members m JOIN email_credentials c ON c.member_id=m.id WHERE m.email=?")
        .bind(email).fetch_optional(db).await.map_err(internal)
}

async fn check_password(hash: String, password: String) -> ApiResult<bool> {
    tokio::task::spawn_blocking(move || verify_password(&hash, &password))
        .await
        .map_err(internal)
}

#[inline]
fn invalid_credentials() -> ApiError {
    ApiError(StatusCode::UNAUTHORIZED, "Invalid email or password")
}
