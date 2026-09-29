//! What clients and operators can see of the queue.
//!
//! Module map (caller-first):
//!   queue_status           GET /queue/{id}: 202 while waiting, then the stored response
//!   ├─ ensure_owner        a member's spooled request is readable only by that member
//!   ├─ still_waiting       202 + x-queued + how many jobs are ahead
//!   └─ finished_result     the stored response (base64 body) or a failure notice
//!   health_figures         inflight, RAM queue and spooled counts for /health
use super::CURRENT;
use crate::{ApiError, ApiResult, AppState, identity::session, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use std::sync::Arc;

type QueueRow = (
    String,
    Option<String>,
    i64,
    String,
    Option<i64>,
    Option<String>,
    Option<Vec<u8>>,
);

/// Mental model: only the owner may look; while the job waits, say how many are ahead; once it
/// is done, hand back exactly what the route answered.
pub async fn queue_status(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let row: Option<QueueRow> = sqlx::query_as("SELECT status, member_id, priority, created_at, response_status, response_type, response_body FROM request_spool WHERE id = ?")
        .bind(&id).fetch_optional(&state.db).await.map_err(internal)?;
    let (status, member, class, created, response_status, kind, body) = row.ok_or(not_found())?;
    ensure_owner(&state, &headers, member).await?;
    if is_waiting(&status) {
        return still_waiting(&state.db, status, class, &created).await;
    }
    Ok((
        StatusCode::OK,
        Json(finished_result(&status, response_status, kind, body)),
    )
        .into_response())
}

async fn ensure_owner(
    state: &AppState,
    headers: &HeaderMap,
    member: Option<String>,
) -> ApiResult<()> {
    let Some(owner) = member else {
        return Ok(());
    };
    let viewer = session::viewer(state, headers).await?;
    if viewer.id != owner {
        return Err(not_found());
    }
    Ok(())
}

async fn still_waiting(
    db: &SqlitePool,
    status: String,
    class: i64,
    created: &str,
) -> ApiResult<Response> {
    let (ahead,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM request_spool WHERE status = 'queued' AND (priority < ?1 OR (priority = ?1 AND created_at < ?2))")
        .bind(class).bind(created).fetch_one(db).await.map_err(internal)?;
    let mut response = (
        StatusCode::ACCEPTED,
        Json(json!({"queued": true, "status": status, "ahead": ahead})),
    )
        .into_response();
    response
        .headers_mut()
        .insert("x-queued", HeaderValue::from_static("1"));
    Ok(response)
}

fn finished_result(
    status: &str,
    response_status: Option<i64>,
    kind: Option<String>,
    body: Option<Vec<u8>>,
) -> Value {
    if status == "done" {
        json!({"status": "done", "response": {"status": response_status, "contentType": kind, "body": STANDARD.encode(body.unwrap_or_default())}})
    } else {
        json!({"status": "failed", "error": "The queued request could not be completed"})
    }
}

/// Live admission figures for /health.
pub async fn health_figures(db: &SqlitePool) -> Value {
    let (active, waiting) = CURRENT
        .get()
        .map_or((0, 0), |admission| admission.gate.load());
    let spooled: i64 = sqlx::query_as::<_, (i64,)>(
        "SELECT COUNT(*) FROM request_spool WHERE status IN ('queued','running')",
    )
    .fetch_one(db)
    .await
    .map(|row| row.0)
    .unwrap_or(-1);
    json!({"inflight": active, "ramQueue": waiting, "spooled": spooled})
}

#[inline]
fn is_waiting(status: &str) -> bool {
    status == "queued" || status == "running"
}

#[inline]
fn not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "Queued request not found")
}
