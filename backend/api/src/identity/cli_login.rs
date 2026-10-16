//! Browser-assisted officer login: bounded, expiring, single-use PKCE handoff.
use super::session::{self, Viewer};
use crate::{ApiError, ApiResult, AppState, bad, check_origin, internal};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Response,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use uuid::Uuid;

const LIFETIME: Duration = Duration::from_secs(300);
const POLL_INTERVAL: Duration = Duration::from_secs(5);
const CAPACITY: usize = 64;
static PENDING: LazyLock<Mutex<HashMap<String, Pending>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct Pending {
    challenge: String,
    code: String,
    origin: String,
    expires: Instant,
    last_poll: Option<Instant>,
    approved: Option<String>,
    attempts: u8,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Start {
    challenge: String,
}

pub(crate) async fn start(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<Start>,
) -> ApiResult<Json<Value>> {
    check_origin(&state, &headers)?;
    if input.challenge.len() != 43
        || !input
            .challenge
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(bad("Invalid PKCE challenge"));
    }
    let now = Instant::now();
    let mut pending = PENDING.lock().await;
    pending.retain(|_, request| request.expires > now);
    if pending.len() >= CAPACITY {
        return Err(denied(
            StatusCode::TOO_MANY_REQUESTS,
            "Login capacity reached",
        ));
    }
    let id = Uuid::new_v4().to_string();
    let code = Uuid::new_v4().simple().to_string()[..8].to_uppercase();
    pending.insert(
        id.clone(),
        Pending {
            challenge: input.challenge,
            code: code.clone(),
            origin: state.allowed_origin.clone(),
            expires: now + LIFETIME,
            last_poll: None,
            approved: None,
            attempts: 0,
        },
    );
    tracing::info!(
        component = "cli_login",
        operation = "start",
        "cli_login.started"
    );
    Ok(Json(
        json!({"requestId":id,"userCode":code,"expiresIn":300,"interval":5}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Approval {
    request_id: String,
    user_code: String,
}

pub(crate) async fn approve(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<Approval>,
) -> ApiResult<Json<Value>> {
    check_origin(&state, &headers)?;
    let actor = session::require_officer(&state, &headers).await?;
    let mut pending = PENDING.lock().await;
    let request = active_request(&mut pending, &input.request_id, &state.allowed_origin)?;
    if request.approved.is_some() {
        return Err(denied(StatusCode::CONFLICT, "Login already approved"));
    }
    request.attempts += 1;
    if request.attempts > 5 || input.user_code != request.code {
        return Err(denied(StatusCode::FORBIDDEN, "Login code mismatch"));
    }
    request.approved = Some(actor.id);
    tracing::info!(
        component = "cli_login",
        operation = "approve",
        "cli_login.approved"
    );
    Ok(Json(json!({"approved":true})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Poll {
    request_id: String,
    verifier: String,
}

// Mental model: prove possession → enforce interval → consume approval → recheck role → issue existing session.
pub(crate) async fn poll(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<Poll>,
) -> ApiResult<Response> {
    check_origin(&state, &headers)?;
    if !(43..=128).contains(&input.verifier.len())
        || !input
            .verifier
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-._~".contains(&c))
    {
        return Err(bad("Invalid PKCE verifier"));
    }
    let member = {
        let mut pending = PENDING.lock().await;
        let request = active_request(&mut pending, &input.request_id, &state.allowed_origin)?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(input.verifier.as_bytes()));
        if challenge != request.challenge {
            return Err(denied(StatusCode::FORBIDDEN, "PKCE verification failed"));
        }
        let now = Instant::now();
        if request
            .last_poll
            .is_some_and(|last| now.duration_since(last) < POLL_INTERVAL)
        {
            return Err(denied(
                StatusCode::TOO_MANY_REQUESTS,
                "Poll interval not reached",
            ));
        }
        request.last_poll = Some(now);
        let member = request.approved.clone().ok_or(denied(
            StatusCode::PRECONDITION_REQUIRED,
            "Browser approval pending",
        ))?;
        pending.remove(&input.request_id);
        member
    };
    let row: Option<(String, String, String)> =
        sqlx::query_as("SELECT id,display_name,role FROM members WHERE id=?")
            .bind(member)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    let (id, display_name, role) =
        row.ok_or(denied(StatusCode::FORBIDDEN, "Officer access required"))?;
    if !crate::portal::is_officer(&role) {
        return Err(denied(StatusCode::FORBIDDEN, "Officer access required"));
    }
    tracing::info!(
        component = "cli_login",
        operation = "complete",
        "cli_login.completed"
    );
    session::issue_session(
        &state,
        Viewer {
            id,
            display_name,
            role,
        },
    )
    .await
}

fn denied(status: StatusCode, message: &'static str) -> ApiError {
    if status != StatusCode::PRECONDITION_REQUIRED {
        tracing::warn!(
            component = "cli_login",
            operation = "handoff",
            status = status.as_u16(),
            "cli_login.denied"
        );
    }
    ApiError(status, message)
}

fn active_request<'a>(
    pending: &'a mut HashMap<String, Pending>,
    id: &str,
    origin: &str,
) -> ApiResult<&'a mut Pending> {
    let request = pending
        .get_mut(id)
        .ok_or(denied(StatusCode::GONE, "Login expired or consumed"))?;
    if request.expires <= Instant::now() || request.attempts > 5 || request.origin != origin {
        return Err(denied(StatusCode::GONE, "Login expired or consumed"));
    }
    Ok(request)
}

#[cfg(test)]
mod tests;
