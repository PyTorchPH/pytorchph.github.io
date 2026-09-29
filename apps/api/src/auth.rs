use crate::{ApiError, ApiResult, AppState, check_origin, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Clone, Serialize)]
pub struct Viewer {
    pub id: String,
    pub display_name: String,
    pub role: String,
}

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

async fn google_keys(state: &AppState) -> ApiResult<JwkSet> {
    let mut guard = state.google_keys.lock().await;
    if let Some((fetched, keys)) = &*guard {
        if fetched.elapsed() < Duration::from_secs(3600) {
            return Ok(keys.clone());
        }
    }
    let keys: JwkSet = state
        .http
        .get("https://www.googleapis.com/oauth2/v3/certs")
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

async fn verify_google(state: &AppState, token: &str) -> ApiResult<GoogleClaims> {
    if token.len() > 8192 {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "Invalid Google token"));
    }
    let header = decode_header(token)
        .map_err(|_| ApiError(StatusCode::UNAUTHORIZED, "Invalid Google token"))?;
    if header.alg != Algorithm::RS256 {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Invalid Google algorithm",
        ));
    }
    let kid = header
        .kid
        .as_deref()
        .ok_or(ApiError(StatusCode::UNAUTHORIZED, "Missing key id"))?;
    let keys = google_keys(state).await?;
    let key = keys
        .find(kid)
        .ok_or(ApiError(StatusCode::UNAUTHORIZED, "Unknown Google key"))?;
    let key = DecodingKey::from_jwk(key).map_err(internal)?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[state.google_client_id.as_str()]);
    validation.set_issuer(&["https://accounts.google.com", "accounts.google.com"]);
    let claims = decode::<GoogleClaims>(token, &key, &validation)
        .map_err(|_| ApiError(StatusCode::UNAUTHORIZED, "Invalid Google token"))?
        .claims;
    if !claims.email_verified || claims.sub.is_empty() || claims.email.len() > 320 {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Unverified Google identity",
        ));
    }
    Ok(claims)
}

pub async fn google_login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<Login>,
) -> ApiResult<Response> {
    check_origin(&state, &headers)?;
    let claims = verify_google(&state, &payload.id_token).await?;
    let email = claims.email.to_ascii_lowercase();
    let role = if email == state.bootstrap_admin_email.to_ascii_lowercase() {
        "admin"
    } else {
        "pending"
    };
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let display_name = claims
        .name
        .unwrap_or_else(|| email.clone())
        .chars()
        .take(100)
        .collect::<String>();
    let existing: Option<String> =
        sqlx::query_scalar("SELECT google_sub FROM members WHERE email = ?")
            .bind(&email)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    match existing {
        Some(sub) if sub.starts_with("email:") => {
            sqlx::query("UPDATE members SET google_sub = ?, display_name = ? WHERE email = ?")
                .bind(&claims.sub)
                .bind(&display_name)
                .bind(&email)
                .execute(&state.db)
                .await
                .map_err(internal)?;
        }
        Some(sub) if sub == claims.sub => {
            sqlx::query("UPDATE members SET display_name = ? WHERE email = ?")
                .bind(&display_name)
                .bind(&email)
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
        None => {
            sqlx::query("INSERT INTO members(id, google_sub, email, display_name, public_handle, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, display_name = excluded.display_name")
                .bind(&id).bind(&claims.sub).bind(&email).bind(&display_name)
                .bind(format!("Member-{}", &id[..8])).bind(role).bind(&now)
                .execute(&state.db).await.map_err(internal)?;
        }
    }
    let row = sqlx::query("SELECT id, display_name, role FROM members WHERE email = ?")
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;
    let viewer = Viewer {
        id: row.get(0),
        display_name: row.get(1),
        role: row.get(2),
    };
    issue_session(&state, viewer).await
}

pub(crate) async fn issue_session(state: &AppState, viewer: Viewer) -> ApiResult<Response> {
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let hash = hex::encode(Sha256::digest(token.as_bytes()));
    let expires = session_expiry(chrono::Utc::now());
    sqlx::query("INSERT INTO sessions(token_hash, member_id, expires_at) VALUES (?, ?, ?)")
        .bind(hash)
        .bind(&viewer.id)
        .bind(expires.to_rfc3339())
        .execute(&state.db)
        .await
        .map_err(internal)?;
    let mut response = Json(viewer).into_response();
    response
        .headers_mut()
        .insert("set-cookie", session_cookie(&token, expires)?);
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

fn session_expiry(now: chrono::DateTime<chrono::Utc>) -> chrono::DateTime<chrono::Utc> {
    now.date_naive()
        .checked_add_days(chrono::Days::new(7))
        .expect("session expiry date is in range")
        .and_hms_opt(23, 59, 59)
        .expect("end of day is valid")
        .and_utc()
}

fn session_cookie(token: &str, expires: chrono::DateTime<chrono::Utc>) -> ApiResult<HeaderValue> {
    let max_age = (expires - chrono::Utc::now()).num_seconds().max(0);
    let expires_http = expires.format("%a, %d %b %Y %H:%M:%S GMT");
    HeaderValue::from_str(&format!(
        "ph_session={token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age={max_age}; Expires={expires_http}"
    ))
    .map_err(internal)
}

fn session_token(headers: &HeaderMap) -> Option<&str> {
    let raw = headers.get("cookie")?.to_str().ok()?;
    let token = raw
        .split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix("ph_session="))?;
    (token.len() == 64 && token.bytes().all(|byte| byte.is_ascii_hexdigit())).then_some(token)
}

pub async fn refresh_session(
    State(state): State<Arc<AppState>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let token = session_token(request.headers()).map(str::to_owned);
    let mut renewed = None;
    if let Some(token) = token {
        let now = chrono::Utc::now();
        let expires = session_expiry(now);
        let hash = hex::encode(Sha256::digest(token.as_bytes()));
        match sqlx::query(
            "UPDATE sessions SET expires_at = ? WHERE token_hash = ? AND expires_at > ?",
        )
        .bind(expires.to_rfc3339())
        .bind(hash)
        .bind(now.to_rfc3339())
        .execute(&state.db)
        .await
        {
            Ok(result) if result.rows_affected() == 1 => renewed = Some((token, expires)),
            Ok(_) => {}
            Err(error) => return internal(error).into_response(),
        }
    }
    let mut response = next.run(request).await;
    if let Some((token, expires)) = renewed {
        if !response.headers().contains_key("set-cookie") {
            match session_cookie(&token, expires) {
                Ok(cookie) => {
                    response.headers_mut().insert("set-cookie", cookie);
                    response
                        .headers_mut()
                        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
                }
                Err(error) => return error.into_response(),
            }
        }
    }
    response
}

pub async fn viewer(state: &AppState, headers: &HeaderMap) -> ApiResult<Viewer> {
    // A spooled request replays as the member it was accepted for; no token is stored.
    if let Some(member) = crate::admission::replay_member() {
        let id = member.ok_or(ApiError(
            StatusCode::UNAUTHORIZED,
            "Authentication required",
        ))?;
        let row = sqlx::query("SELECT id, display_name, role FROM members WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?
            .ok_or(ApiError(StatusCode::UNAUTHORIZED, "Session expired"))?;
        return Ok(Viewer {
            id: row.get(0),
            display_name: row.get(1),
            role: row.get(2),
        });
    }
    let token = session_token(headers).ok_or(ApiError(
        StatusCode::UNAUTHORIZED,
        "Authentication required",
    ))?;
    let hash = hex::encode(Sha256::digest(token.as_bytes()));
    let row = sqlx::query("SELECT m.id, m.display_name, m.role FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = ? AND s.expires_at > ?")
        .bind(hash).bind(chrono::Utc::now().to_rfc3339()).fetch_optional(&state.db).await.map_err(internal)?
        .ok_or(ApiError(StatusCode::UNAUTHORIZED, "Session expired"))?;
    Ok(Viewer {
        id: row.get(0),
        display_name: row.get(1),
        role: row.get(2),
    })
}

pub async fn require_officer(state: &AppState, headers: &HeaderMap) -> ApiResult<Viewer> {
    let viewer = viewer(state, headers).await?;
    if viewer.role != "officer" && viewer.role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"));
    }
    Ok(viewer)
}

pub async fn me(State(state): State<Arc<AppState>>, headers: HeaderMap) -> ApiResult<Json<Viewer>> {
    Ok(Json(viewer(&state, &headers).await?))
}

pub async fn signout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    check_origin(&state, &headers)?;
    let revoked = if let Some(token) = session_token(&headers) {
        let hash = hex::encode(Sha256::digest(token.as_bytes()));
        sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
            .bind(hash)
            .execute(&state.db)
            .await
            .map_err(internal)?
            .rows_affected()
    } else {
        0
    };
    tracing::info!(
        component = "auth",
        operation = "signout",
        revoked,
        "auth.session_signed_out"
    );
    let mut response = Json(serde_json::json!({ "ok": true })).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static("ph_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberListItem {
    id: String,
    display_name: String,
    role: String,
}

#[derive(Deserialize)]
pub struct DeleteAccount {
    confirm: String,
}

/// A member leaving PyTorch PH deletes their account; foreign keys cascade every row they
/// own (sessions, points, claims, attendance, roles, audit, portal state).
pub async fn delete_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<DeleteAccount>,
) -> ApiResult<Response> {
    check_origin(&state, &headers)?;
    let actor = viewer(&state, &headers).await?;
    if input.confirm != "DELETE" {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Type DELETE to confirm account deletion",
        ));
    }
    if actor.role == "admin" {
        let (admins,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM members WHERE role = 'admin'")
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;
        if admins <= 1 {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Assign another admin before deleting the last admin account",
            ));
        }
    }
    let deleted = sqlx::query("DELETE FROM members WHERE id = ?")
        .bind(&actor.id)
        .execute(&state.db)
        .await
        .map_err(internal)?
        .rows_affected();
    tracing::info!(
        component = "auth",
        operation = "delete_account",
        role = %actor.role,
        deleted,
        "auth.account_deleted"
    );
    let mut response = Json(serde_json::json!({ "ok": true })).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static("ph_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

pub async fn list_members(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<MemberListItem>>> {
    let actor = require_officer(&state, &headers).await?;
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id,display_name,role FROM members WHERE role != 'pending' OR ? = 'admin' ORDER BY display_name LIMIT 500"
    ).bind(&actor.role).fetch_all(&state.db).await.map_err(internal)?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, display_name, role)| MemberListItem {
                id,
                display_name,
                role,
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct Approval {
    role: String,
}

pub async fn approve_member(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<Approval>,
) -> ApiResult<StatusCode> {
    check_origin(&state, &headers)?;
    let actor = viewer(&state, &headers).await?;
    if actor.role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Admin access required"));
    }
    if payload.role != "member" && payload.role != "officer" {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid approval role",
        ));
    }
    let changed = sqlx::query("UPDATE members SET role = ? WHERE id = ? AND role = 'pending'")
        .bind(&payload.role)
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(internal)?
        .rows_affected();
    if changed == 0 {
        return Err(ApiError(StatusCode::NOT_FOUND, "Pending member not found"));
    }
    tracing::info!(actor_id = %actor.id, member_id = %id, role = %payload.role, "member.approved");
    Ok(StatusCode::NO_CONTENT)
}
