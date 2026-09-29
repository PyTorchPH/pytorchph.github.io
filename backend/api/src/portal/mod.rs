//! The /portal/api gateway behind the member portal.
//!
//! Module map (caller-first):
//!   gateway                       one portal request: who asks, may they, read or write
//!   ├─ ensure_portal_access       approved members only; officer paths need an officer
//!   ├─ reads::answer_read         GET: special reads, table-backed views, saved state, fixtures
//!   ├─ writes::dispatch_write     every other method, one write at a time
//!   ├─ log_saved_action
//!   └─ reply                      JSON with private, no-store caching
//!
//! Supporting modules:
//!   fixtures    fallback content of every view (demo seed file)
//!   store       portal_state: per-member and organization values
//!   overlays    live data layered over product views
//!   member      privacy choices and leaderboard identity
//!   feedback    bug reports list, triage and notes
//!   product/*   product view actions (demo actions, opportunities, evidence, photos, sources)
//!   media       owner-only evidence photos
//!   operations  client operational events and the AI provider catalog
//!   fields      reading and bounding request fields
mod feedback;
mod fields;
mod fixtures;
mod media;
mod member;
mod operations;
mod overlays;
mod product;
mod reads;
mod store;
mod writes;

pub(crate) use feedback::feedback_rows;
pub use media::media;

use crate::{
    ApiError, ApiResult, AppState, check_origin,
    identity::session::{self, Viewer},
};
use axum::{
    Json,
    body::Bytes,
    extract::{OriginalUri, Path, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex;

// Portal writes rewrite whole JSON documents, so they run one at a time.
static WRITE_LOCK: Mutex<()> = Mutex::const_new(());

// Mental model: identify the member, check they may use this path, then answer a read
// directly or serialize a write behind one lock.
pub async fn gateway(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
    OriginalUri(uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    let actor = session::viewer(&state, &headers).await?;
    ensure_portal_access(&actor, &path)?;
    if method == Method::GET {
        return reads::answer_read(&state.db, &actor, &path, uri.query()).await;
    }
    check_origin(&state, &headers)?;
    let _write_guard = WRITE_LOCK.lock().await;
    let input = fields::json_body(&body)?;
    let (status, result) =
        writes::dispatch_write(&state, &actor, method.as_str(), &path, input).await?;
    log_saved_action(&path, &actor);
    Ok(reply(status, result))
}

fn ensure_portal_access(actor: &Viewer, path: &str) -> ApiResult<()> {
    if actor.role == "pending" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Member approval required"));
    }
    if is_officer_path(path) && !is_officer(&actor.role) {
        return Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"));
    }
    Ok(())
}

fn log_saved_action(path: &str, actor: &Viewer) {
    tracing::info!(event="portal.action.saved", component="portal", operation=%path, actor_id=%actor.id, outcome="success");
}

pub(crate) fn reply(status: StatusCode, body: Value) -> Response {
    let mut response = (status, Json(body)).into_response();
    response
        .headers_mut()
        .insert("cache-control", "private, no-store".parse().unwrap());
    response
}

#[inline]
pub(crate) fn is_officer(role: &str) -> bool {
    role == "admin" || role == "officer"
}

#[inline]
fn is_officer_path(path: &str) -> bool {
    path.starts_with("officer/")
}
