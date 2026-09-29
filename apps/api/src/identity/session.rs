//! Browser sessions: who is signed in, and the `ph_session` cookie that proves it.
//!
//! Module map (caller-first):
//!   viewer                      resolves the signed-in member for a request
//!   ├─ replayed_viewer          a spooled request replays as the member it was accepted for
//!   ├─ session_token            reads a well-formed token from the cookie header
//!   └─ member_for_token         looks up the member behind an unexpired session
//!   me                          GET /auth/me
//!   signout                     POST /auth/signout: revoke the session, clear the cookie
//!   issue_session               starts a session after any successful sign-in
//!   refresh_session             middleware: slides the session expiry on every request
//!   ├─ extend_session           pushes an unexpired session's expiry forward
//!   └─ attach_renewed_cookie    re-sends the cookie unless the handler already set one
//!   session_expiry / session_cookie / cleared_session_cookie / hash_token / no_store
//!
//! Sign-in flows, membership administration and account deletion live in sibling modules and
//! are re-exported here so callers keep one path for everything session-related.
use crate::{ApiError, ApiResult, AppState, check_origin, internal};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool, sqlite::SqliteRow};
use std::sync::Arc;
use uuid::Uuid;

pub(crate) use super::account_deletion::delete_account;
pub(crate) use super::google::google_login;
pub(crate) use super::membership::{approve_member, list_members, require_officer};

const SESSION_COOKIE: &str = "ph_session";
const SESSION_TOKEN_LENGTH: usize = 64;
const SESSION_DAYS: u64 = 7;
const CLEARED_SESSION_COOKIE: &str = "ph_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";

#[derive(Clone, Serialize)]
pub struct Viewer {
    pub id: String,
    pub display_name: String,
    pub role: String,
}

impl Viewer {
    #[inline]
    fn from_row(row: &SqliteRow) -> Self {
        Self {
            id: row.get(0),
            display_name: row.get(1),
            role: row.get(2),
        }
    }
}

/// Mental model: a replayed request already carries its member; otherwise the cookie must
/// name an unexpired session.
pub async fn viewer(state: &AppState, headers: &HeaderMap) -> ApiResult<Viewer> {
    if let Some(member) = crate::http::admission::replay_member() {
        return replayed_viewer(&state.db, member).await;
    }
    let token = session_token(headers).ok_or(unauthenticated())?;
    member_for_token(&state.db, token).await
}

// A spooled request replays as the member it was accepted for; no token is stored.
async fn replayed_viewer(db: &SqlitePool, member: Option<String>) -> ApiResult<Viewer> {
    let id = member.ok_or(unauthenticated())?;
    let row = sqlx::query("SELECT id, display_name, role FROM members WHERE id = ?")
        .bind(id)
        .fetch_optional(db)
        .await
        .map_err(internal)?
        .ok_or(session_expired())?;
    Ok(Viewer::from_row(&row))
}

pub(crate) fn session_token(headers: &HeaderMap) -> Option<&str> {
    let raw = headers.get("cookie")?.to_str().ok()?;
    let token = raw
        .split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix("ph_session="))?;
    is_well_formed_token(token).then_some(token)
}

async fn member_for_token(db: &SqlitePool, token: &str) -> ApiResult<Viewer> {
    let row = sqlx::query("SELECT m.id, m.display_name, m.role FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = ? AND s.expires_at > ?")
        .bind(hash_token(token)).bind(chrono::Utc::now().to_rfc3339()).fetch_optional(db).await.map_err(internal)?
        .ok_or(session_expired())?;
    Ok(Viewer::from_row(&row))
}

pub async fn me(State(state): State<Arc<AppState>>, headers: HeaderMap) -> ApiResult<Json<Viewer>> {
    Ok(Json(viewer(&state, &headers).await?))
}

pub async fn signout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    check_origin(&state, &headers)?;
    let revoked = revoke_session(&state.db, session_token(&headers)).await?;
    tracing::info!(
        component = "auth",
        operation = "signout",
        revoked,
        "auth.session_signed_out"
    );
    Ok(ok_with_cleared_session())
}

async fn revoke_session(db: &SqlitePool, token: Option<&str>) -> ApiResult<u64> {
    let Some(token) = token else {
        return Ok(0);
    };
    Ok(sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
        .bind(hash_token(token))
        .execute(db)
        .await
        .map_err(internal)?
        .rows_affected())
}

pub(crate) async fn issue_session(state: &AppState, viewer: Viewer) -> ApiResult<Response> {
    let token = new_session_token();
    let expires = session_expiry(chrono::Utc::now());
    sqlx::query("INSERT INTO sessions(token_hash, member_id, expires_at) VALUES (?, ?, ?)")
        .bind(hash_token(&token))
        .bind(&viewer.id)
        .bind(expires.to_rfc3339())
        .execute(&state.db)
        .await
        .map_err(internal)?;
    let mut response = Json(viewer).into_response();
    response
        .headers_mut()
        .insert("set-cookie", session_cookie(&token, expires)?);
    no_store(&mut response);
    Ok(response)
}

/// Mental model: every authenticated request pushes the session's expiry forward, then the
/// fresh cookie rides back on the handler's response.
pub async fn refresh_session(
    State(state): State<Arc<AppState>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let token = session_token(request.headers()).map(str::to_owned);
    let renewed = match token {
        Some(token) => match extend_session(&state.db, token).await {
            Ok(renewed) => renewed,
            Err(error) => return error.into_response(),
        },
        None => None,
    };
    let response = next.run(request).await;
    match renewed {
        Some((token, expires)) => attach_renewed_cookie(response, &token, expires),
        None => response,
    }
}

type Renewal = (String, chrono::DateTime<chrono::Utc>);

async fn extend_session(db: &SqlitePool, token: String) -> ApiResult<Option<Renewal>> {
    let now = chrono::Utc::now();
    let expires = session_expiry(now);
    let result =
        sqlx::query("UPDATE sessions SET expires_at = ? WHERE token_hash = ? AND expires_at > ?")
            .bind(expires.to_rfc3339())
            .bind(hash_token(&token))
            .bind(now.to_rfc3339())
            .execute(db)
            .await
            .map_err(internal)?;
    Ok((result.rows_affected() == 1).then_some((token, expires)))
}

fn attach_renewed_cookie(
    mut response: Response,
    token: &str,
    expires: chrono::DateTime<chrono::Utc>,
) -> Response {
    if response.headers().contains_key("set-cookie") {
        return response;
    }
    match session_cookie(token, expires) {
        Ok(cookie) => {
            response.headers_mut().insert("set-cookie", cookie);
            no_store(&mut response);
            response
        }
        Err(error) => error.into_response(),
    }
}

// Sessions end at 23:59:59 UTC on the seventh calendar day after their last use.
fn session_expiry(now: chrono::DateTime<chrono::Utc>) -> chrono::DateTime<chrono::Utc> {
    now.date_naive()
        .checked_add_days(chrono::Days::new(SESSION_DAYS))
        .expect("session expiry date is in range")
        .and_hms_opt(23, 59, 59)
        .expect("end of day is valid")
        .and_utc()
}

fn session_cookie(token: &str, expires: chrono::DateTime<chrono::Utc>) -> ApiResult<HeaderValue> {
    let max_age = (expires - chrono::Utc::now()).num_seconds().max(0);
    let expires_http = expires.format("%a, %d %b %Y %H:%M:%S GMT");
    HeaderValue::from_str(&format!(
        "{SESSION_COOKIE}={token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age={max_age}; Expires={expires_http}"
    ))
    .map_err(internal)
}

/// `{"ok": true}` that also removes the session cookie (sign-out, account deletion).
pub(crate) fn ok_with_cleared_session() -> Response {
    let mut response = Json(serde_json::json!({ "ok": true })).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static(CLEARED_SESSION_COOKIE),
    );
    no_store(&mut response);
    response
}

#[inline]
fn no_store(response: &mut Response) {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
}

#[inline]
fn new_session_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

#[inline]
fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

#[inline]
fn is_well_formed_token(token: &str) -> bool {
    token.len() == SESSION_TOKEN_LENGTH && token.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[inline]
fn unauthenticated() -> ApiError {
    ApiError(StatusCode::UNAUTHORIZED, "Authentication required")
}

#[inline]
fn session_expired() -> ApiError {
    ApiError(StatusCode::UNAUTHORIZED, "Session expired")
}
