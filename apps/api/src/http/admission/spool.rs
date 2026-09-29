//! The disk side of admission: requests that do not fit in RAM are written to request_spool
//! and answered 202 at once.
//!
//! Module map (caller-first):
//!   spool                   stores one overflowing request, or refuses when the budget is spent
//!   ├─ spooled_bytes        bytes of bodies and stored responses on disk
//!   ├─ spool_full           503 + Retry-After: 30
//!   ├─ owner_of             the member the request is for (never the session token)
//!   ├─ store_request        one queued row with its expiry
//!   └─ accepted             202 + x-queued + Location: /queue/{id}
use super::Admission;
use crate::{ApiError, ApiResult, identity::session, internal};
use axum::{
    Json,
    body::Bytes,
    extract::Request,
    http::{HeaderMap, HeaderValue, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
};
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

const MAX_BODY: usize = 384 * 1024;
const RETRY_AFTER_SECONDS: &str = "30";

/// Mental model: read the body within the request limit, check the disk budget, remember who
/// sent it, store it, and tell the client where to collect the answer.
pub(super) async fn spool(
    admission: &Admission,
    class: u8,
    request: Request,
) -> ApiResult<Response> {
    let (parts, body) = request.into_parts();
    let body = axum::body::to_bytes(body, MAX_BODY)
        .await
        .map_err(|_| ApiError(StatusCode::PAYLOAD_TOO_LARGE, "Request body is too large"))?;
    let db = &admission.state.db;
    if exceeds_budget(
        spooled_bytes(db).await?,
        &body,
        admission.config.spool_max_bytes,
    ) {
        return Ok(spool_full());
    }
    let member = owner_of(admission, &parts.headers).await;
    let id = store_request(admission, class, &parts, member, &body).await?;
    tracing::info!(component = "admission", operation = "spool", priority = class, method = %parts.method, outcome = "queued", "admission.request_spooled");
    Ok(accepted(&id))
}

async fn spooled_bytes(db: &SqlitePool) -> ApiResult<i64> {
    let (bytes,): (i64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(COALESCE(length(body),0) + COALESCE(length(response_body),0)), 0) FROM request_spool",
    )
    .fetch_one(db)
    .await
    .map_err(internal)?;
    Ok(bytes)
}

#[inline]
fn exceeds_budget(spooled: i64, body: &Bytes, budget: i64) -> bool {
    spooled + body.len() as i64 > budget
}

fn spool_full() -> Response {
    tracing::warn!(
        component = "admission",
        operation = "spool",
        outcome = "rejected",
        "admission.spool_full"
    );
    let mut response = ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "The server queue is full; try again shortly",
    )
    .into_response();
    response.headers_mut().insert(
        header::RETRY_AFTER,
        HeaderValue::from_static(RETRY_AFTER_SECONDS),
    );
    response
}

// The owner is resolved now so no session token is ever written to disk.
async fn owner_of(admission: &Admission, headers: &HeaderMap) -> Option<String> {
    session::viewer(&admission.state, headers)
        .await
        .ok()
        .map(|viewer| viewer.id)
}

async fn store_request(
    admission: &Admission,
    class: u8,
    parts: &Parts,
    member: Option<String>,
    body: &Bytes,
) -> ApiResult<String> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now();
    let expires = now + chrono::Duration::hours(admission.config.result_ttl_hours);
    sqlx::query("INSERT INTO request_spool(id,priority,member_id,method,path,content_type,origin,body,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,'queued',?,?)")
        .bind(&id).bind(i64::from(class)).bind(&member).bind(parts.method.as_str()).bind(path_with_query(parts))
        .bind(header_text(&parts.headers, header::CONTENT_TYPE)).bind(header_text(&parts.headers, header::ORIGIN)).bind(body.as_ref())
        .bind(now.to_rfc3339()).bind(expires.to_rfc3339())
        .execute(&admission.state.db).await.map_err(internal)?;
    Ok(id)
}

#[inline]
fn path_with_query(parts: &Parts) -> String {
    parts.uri.path_and_query().map_or_else(
        || parts.uri.path().to_owned(),
        |value| value.as_str().to_owned(),
    )
}

#[inline]
fn header_text(headers: &HeaderMap, name: header::HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

fn accepted(id: &str) -> Response {
    let mut response = (
        StatusCode::ACCEPTED,
        Json(json!({"queued": true, "jobId": id, "status": "queued"})),
    )
        .into_response();
    response
        .headers_mut()
        .insert("x-queued", HeaderValue::from_static("1"));
    if let Ok(location) = HeaderValue::from_str(&format!("/queue/{id}")) {
        response.headers_mut().insert(header::LOCATION, location);
    }
    response
}
