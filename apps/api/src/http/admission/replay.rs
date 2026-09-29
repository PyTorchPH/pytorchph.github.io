//! Spool workers: replay stored requests through the router and keep their responses.
//!
//! Module map (caller-first):
//!   spool_worker            loop: replay while work exists, sweep expired results when idle
//!   run_next                one spooled request, highest priority first
//!   ├─ next_job             the next queued row
//!   ├─ claim                queued → running (so two workers never take the same job)
//!   ├─ rebuild_request      method, path, content type, origin and body as received
//!   ├─ replay_as_member     runs the router with REPLAY_MEMBER set for the request's owner
//!   ├─ store_response       done: status, content type and bounded body
//!   └─ mark_failed          failed: the request could not be rebuilt or replayed
//!   recover                 running → queued after a restart
//!   cleanup                 deletes finished rows past their expiry
//!   replay_member           the owner of the request being replayed, if inside a replay
use super::Admission;
use crate::{ApiResult, internal};
use axum::{
    body::{Body, Bytes},
    extract::Request,
    http::{Response, header},
};
use sqlx::SqlitePool;
use std::{sync::Arc, time::Duration};
use tower::ServiceExt;

const MAX_STORED_RESPONSE: usize = 1024 * 1024;
const IDLE_POLL: Duration = Duration::from_millis(500);
const CLEANUP_EVERY: u32 = 120;
const MAX_PRIORITY: i64 = 9;

tokio::task_local! {
    // Set only by spool workers while replaying: the member the request was accepted for.
    static REPLAY_MEMBER: Option<String>;
}

/// The member a spooled request belongs to, when running inside a replay.
pub fn replay_member() -> Option<Option<String>> {
    REPLAY_MEMBER.try_with(Clone::clone).ok()
}

struct SpooledRequest {
    id: String,
    class: i64,
    member: Option<String>,
    method: String,
    path: String,
    content_type: Option<String>,
    origin: Option<String>,
    body: Option<Vec<u8>>,
}

type SpoolRow = (
    String,
    i64,
    Option<String>,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<Vec<u8>>,
);

/// Mental model: keep replaying while jobs exist; when idle, sleep briefly and, every so
/// often, sweep expired results.
pub async fn spool_worker(admission: Arc<Admission>, app: axum::Router) {
    let mut idle_rounds = 0u32;
    loop {
        match run_next(&admission, &app).await {
            Ok(true) => continue,
            Ok(false) => {}
            Err(error) => tracing::error!(error = ?error.1, "admission.worker_error"),
        }
        idle_rounds += 1;
        if is_cleanup_round(idle_rounds) {
            if let Err(error) = cleanup(&admission.state.db).await {
                tracing::error!(error = ?error.1, "admission.cleanup_error");
            }
        }
        tokio::time::sleep(IDLE_POLL).await;
    }
}

/// Runs one spooled request through the router and stores its response. Returns false when idle.
///
/// Mental model: pick the best job, wait for a RAM slot at its priority, claim it, replay it as
/// its owner, then record the outcome.
pub async fn run_next(admission: &Arc<Admission>, app: &axum::Router) -> ApiResult<bool> {
    let db = &admission.state.db;
    let Some(job) = next_job(db).await? else {
        return Ok(false);
    };
    let Some(permit) = admission.gate.acquire(slot_priority(job.class)).await else {
        return Ok(true);
    };
    if !claim(db, &job.id).await? {
        return Ok(true);
    }
    let id = job.id.clone();
    let outcome = replay_as_member(app, job).await;
    drop(permit);
    let finished = chrono::Utc::now().to_rfc3339();
    match outcome {
        Some(response) => store_response(db, &id, &finished, response).await?,
        None => mark_failed(db, &id, &finished).await?,
    }
    Ok(true)
}

async fn next_job(db: &SqlitePool) -> ApiResult<Option<SpooledRequest>> {
    let row: Option<SpoolRow> = sqlx::query_as("SELECT id, priority, member_id, method, path, content_type, origin, body FROM request_spool WHERE status = 'queued' ORDER BY priority, created_at LIMIT 1")
        .fetch_optional(db)
        .await
        .map_err(internal)?;
    Ok(row.map(
        |(id, class, member, method, path, content_type, origin, body)| SpooledRequest {
            id,
            class,
            member,
            method,
            path,
            content_type,
            origin,
            body,
        },
    ))
}

async fn claim(db: &SqlitePool, id: &str) -> ApiResult<bool> {
    let claimed = sqlx::query("UPDATE request_spool SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'")
        .bind(chrono::Utc::now().to_rfc3339()).bind(id)
        .execute(db).await.map_err(internal)?.rows_affected();
    Ok(claimed != 0)
}

async fn replay_as_member(app: &axum::Router, job: SpooledRequest) -> Option<Response<Body>> {
    let member = job.member.clone();
    let request = rebuild_request(job)?;
    REPLAY_MEMBER
        .scope(member, app.clone().oneshot(request))
        .await
        .ok()
}

fn rebuild_request(job: SpooledRequest) -> Option<Request> {
    let mut builder = Request::builder()
        .method(job.method.as_str())
        .uri(job.path.as_str());
    if let Some(value) = job.content_type {
        builder = builder.header(header::CONTENT_TYPE, value);
    }
    if let Some(value) = job.origin {
        builder = builder.header(header::ORIGIN, value);
    }
    builder.body(Body::from(job.body.unwrap_or_default())).ok()
}

async fn store_response(
    db: &SqlitePool,
    id: &str,
    finished: &str,
    response: Response<Body>,
) -> ApiResult<()> {
    let status = response.status().as_u16();
    let kind = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let bytes = axum::body::to_bytes(response.into_body(), MAX_STORED_RESPONSE)
        .await
        .unwrap_or_else(|_| Bytes::from_static(b"{\"error\":\"Response too large to store\"}"));
    sqlx::query("UPDATE request_spool SET status = 'done', response_status = ?, response_type = ?, response_body = ?, body = NULL, finished_at = ? WHERE id = ?")
        .bind(i64::from(status)).bind(kind).bind(bytes.as_ref()).bind(finished).bind(id)
        .execute(db).await.map_err(internal)?;
    tracing::info!(
        component = "admission",
        operation = "replay",
        status,
        outcome = "done",
        "admission.request_replayed"
    );
    Ok(())
}

async fn mark_failed(db: &SqlitePool, id: &str, finished: &str) -> ApiResult<()> {
    sqlx::query(
        "UPDATE request_spool SET status = 'failed', body = NULL, finished_at = ? WHERE id = ?",
    )
    .bind(finished)
    .bind(id)
    .execute(db)
    .await
    .map_err(internal)?;
    tracing::error!(
        component = "admission",
        operation = "replay",
        outcome = "failed",
        "admission.request_failed"
    );
    Ok(())
}

/// Requests interrupted by a restart go back into the spool.
pub async fn recover(db: &SqlitePool) -> ApiResult<u64> {
    Ok(sqlx::query(
        "UPDATE request_spool SET status = 'queued', started_at = NULL WHERE status = 'running'",
    )
    .execute(db)
    .await
    .map_err(internal)?
    .rows_affected())
}

pub async fn cleanup(db: &SqlitePool) -> ApiResult<u64> {
    Ok(sqlx::query("DELETE FROM request_spool WHERE status IN ('done','failed') AND julianday(expires_at) < julianday(?)")
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(db)
        .await
        .map_err(internal)?
        .rows_affected())
}

#[inline]
fn slot_priority(class: i64) -> u8 {
    class.clamp(0, MAX_PRIORITY) as u8
}

#[inline]
fn is_cleanup_round(idle_rounds: u32) -> bool {
    idle_rounds % CLEANUP_EVERY == 0
}
