//! Admission control ("the bouncer"). A fixed number of requests run at once; the rest wait
//! in a RAM priority queue (binary heap: lower class first, then arrival order). When that
//! queue is full, requests are written to an on-disk spool (SQLite) and answered at once with
//! 202 + a job id; spool workers replay them through the same router, highest priority first,
//! and store the response for the client to collect from GET /queue/{id}.
//! Auth requests never spill (their responses set cookies), and only a full spool — the disk
//! budget — ever produces 503. Limits come from the environment (see Config::from_env).
use crate::{ApiError, ApiResult, AppState, auth, internal};
use axum::{
    Json,
    body::{Body, Bytes},
    extract::{Path, Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use std::{
    cmp::Ordering,
    collections::BinaryHeap,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::sync::oneshot;
use tower::ServiceExt;
use uuid::Uuid;

const MAX_BODY: usize = 384 * 1024;
const MAX_STORED_RESPONSE: usize = 1024 * 1024;
const IDLE_POLL: Duration = Duration::from_millis(500);
const CLEANUP_EVERY: u32 = 120;

#[derive(Clone, Debug)]
pub struct Config {
    pub max_inflight: usize,
    pub ram_queue_depth: usize,
    pub spool_max_bytes: i64,
    pub result_ttl_hours: i64,
    pub spool_workers: usize,
}

impl Config {
    /// API_MAX_INFLIGHT (default vCPUs × 2), API_RAM_QUEUE_DEPTH (64), API_SPOOL_MAX_MB (500),
    /// API_RESULT_TTL_HOURS (24), API_SPOOL_WORKERS (1).
    pub fn from_env() -> Self {
        let cpus = std::thread::available_parallelism().map_or(1, usize::from);
        let read = |name: &str, default: i64| -> i64 {
            std::env::var(name)
                .ok()
                .and_then(|value| value.trim().parse().ok())
                .filter(|value: &i64| *value >= 0)
                .unwrap_or(default)
        };
        Self {
            max_inflight: read("API_MAX_INFLIGHT", (cpus * 2) as i64).max(1) as usize,
            ram_queue_depth: read("API_RAM_QUEUE_DEPTH", 64) as usize,
            spool_max_bytes: read("API_SPOOL_MAX_MB", 500) * 1024 * 1024,
            result_ttl_hours: read("API_RESULT_TTL_HOURS", 24).max(1),
            spool_workers: read("API_SPOOL_WORKERS", 1).max(1) as usize,
        }
    }
}

/// Lower number = served first. 0 never queues.
pub fn priority(method: &Method, path: &str) -> u8 {
    if method == Method::OPTIONS || path == "/health" || path.starts_with("/queue/") {
        return 0;
    }
    if path.starts_with("/auth/") {
        return 1;
    }
    let heavy = path.contains("/attachments")
        || path.starts_with("/evidence/extension")
        || path.starts_with("/portal/media")
        || path.starts_with("/internal/");
    if heavy {
        4
    } else if method == Method::GET {
        2
    } else {
        3
    }
}

struct Waiter {
    priority: u8,
    seq: u64,
    tx: oneshot::Sender<Permit>,
}

impl PartialEq for Waiter {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority && self.seq == other.seq
    }
}
impl Eq for Waiter {}
impl PartialOrd for Waiter {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Waiter {
    // BinaryHeap pops the greatest: lowest priority number, then earliest arrival.
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .priority
            .cmp(&self.priority)
            .then(other.seq.cmp(&self.seq))
    }
}

#[derive(Default)]
struct GateState {
    active: usize,
    heap: BinaryHeap<Waiter>,
    seq: u64,
}

pub struct Gate {
    state: Mutex<GateState>,
    max_inflight: usize,
    ram_queue_depth: usize,
}

/// One running slot. Dropping it hands the slot to the highest-priority waiter.
pub struct Permit {
    gate: Arc<Gate>,
}

impl Drop for Permit {
    fn drop(&mut self) {
        loop {
            let mut state = self
                .gate
                .state
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            let Some(waiter) = state.heap.pop() else {
                state.active = state.active.saturating_sub(1);
                return;
            };
            drop(state);
            match waiter.tx.send(Permit {
                gate: self.gate.clone(),
            }) {
                Ok(()) => return,
                // The waiter left (client disconnected); pass the slot on without releasing it.
                Err(orphan) => std::mem::forget(orphan),
            }
        }
    }
}

pub enum Admit {
    Now(Permit),
    Wait(oneshot::Receiver<Permit>),
    Full,
}

impl Gate {
    pub fn new(max_inflight: usize, ram_queue_depth: usize) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::default(),
            max_inflight,
            ram_queue_depth,
        })
    }

    /// `may_spill` requests are refused (Full) when the RAM queue is at its depth.
    pub fn enter(self: &Arc<Self>, priority: u8, may_spill: bool) -> Admit {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if state.active < self.max_inflight {
            state.active += 1;
            return Admit::Now(Permit { gate: self.clone() });
        }
        if may_spill && state.heap.len() >= self.ram_queue_depth {
            return Admit::Full;
        }
        let (tx, rx) = oneshot::channel();
        state.seq += 1;
        let seq = state.seq;
        state.heap.push(Waiter { priority, seq, tx });
        Admit::Wait(rx)
    }

    pub async fn acquire(self: &Arc<Self>, priority: u8) -> Option<Permit> {
        match self.enter(priority, false) {
            Admit::Now(permit) => Some(permit),
            Admit::Wait(rx) => rx.await.ok(),
            Admit::Full => None,
        }
    }

    pub fn load(&self) -> (usize, usize) {
        let state = self
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        (state.active, state.heap.len())
    }
}

pub struct Admission {
    pub gate: Arc<Gate>,
    pub config: Config,
    pub state: Arc<AppState>,
}

static CURRENT: OnceLock<Arc<Admission>> = OnceLock::new();

tokio::task_local! {
    // Set only by spool workers while replaying: the member the request was accepted for.
    static REPLAY_MEMBER: Option<String>;
}

/// The member a spooled request belongs to, when running inside a replay.
pub fn replay_member() -> Option<Option<String>> {
    REPLAY_MEMBER.try_with(Clone::clone).ok()
}

impl Admission {
    pub fn new(config: Config, state: Arc<AppState>) -> Arc<Self> {
        let admission = Arc::new(Self {
            gate: Gate::new(config.max_inflight, config.ram_queue_depth),
            config,
            state,
        });
        let _ = CURRENT.set(admission.clone());
        admission
    }
}

pub async fn admit(
    State(admission): State<Arc<Admission>>,
    request: Request,
    next: Next,
) -> Response {
    let class = priority(request.method(), request.uri().path());
    if class == 0 || replay_member().is_some() {
        return next.run(request).await;
    }
    let may_spill = class >= 2;
    let permit = match admission.gate.enter(class, may_spill) {
        Admit::Now(permit) => permit,
        Admit::Wait(rx) => match rx.await {
            Ok(permit) => permit,
            Err(_) => {
                return ApiError(StatusCode::SERVICE_UNAVAILABLE, "Server is restarting")
                    .into_response();
            }
        },
        Admit::Full => {
            return spool(&admission, class, request)
                .await
                .unwrap_or_else(IntoResponse::into_response);
        }
    };
    let response = next.run(request).await;
    drop(permit);
    response
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

async fn spool(admission: &Admission, class: u8, request: Request) -> ApiResult<Response> {
    let (parts, body) = request.into_parts();
    let body = axum::body::to_bytes(body, MAX_BODY)
        .await
        .map_err(|_| ApiError(StatusCode::PAYLOAD_TOO_LARGE, "Request body is too large"))?;
    let db = &admission.state.db;
    if spooled_bytes(db).await? + body.len() as i64 > admission.config.spool_max_bytes {
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
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("30"));
        return Ok(response);
    }
    // The owner is resolved now so no session token is ever written to disk.
    let member = auth::viewer(&admission.state, &parts.headers)
        .await
        .ok()
        .map(|viewer| viewer.id);
    let text = |name: header::HeaderName| {
        parts
            .headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    };
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now();
    let path = parts.uri.path_and_query().map_or_else(
        || parts.uri.path().to_owned(),
        |value| value.as_str().to_owned(),
    );
    sqlx::query("INSERT INTO request_spool(id,priority,member_id,method,path,content_type,origin,body,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,'queued',?,?)")
        .bind(&id).bind(i64::from(class)).bind(&member).bind(parts.method.as_str()).bind(&path)
        .bind(text(header::CONTENT_TYPE)).bind(text(header::ORIGIN)).bind(body.as_ref())
        .bind(now.to_rfc3339()).bind((now + chrono::Duration::hours(admission.config.result_ttl_hours)).to_rfc3339())
        .execute(db).await.map_err(internal)?;
    tracing::info!(component = "admission", operation = "spool", priority = class, method = %parts.method, outcome = "queued", "admission.request_spooled");
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
    Ok(response)
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

async fn next_job(db: &SqlitePool) -> ApiResult<Option<SpoolRow>> {
    sqlx::query_as("SELECT id, priority, member_id, method, path, content_type, origin, body FROM request_spool WHERE status = 'queued' ORDER BY priority, created_at LIMIT 1")
        .fetch_optional(db)
        .await
        .map_err(internal)
}

/// Runs one spooled request through the router and stores its response. Returns false when idle.
pub async fn run_next(admission: &Arc<Admission>, app: &axum::Router) -> ApiResult<bool> {
    let db = &admission.state.db;
    let Some((id, class, member, method, path, content_type, origin, body)) = next_job(db).await?
    else {
        return Ok(false);
    };
    let Some(permit) = admission.gate.acquire(class.clamp(0, 9) as u8).await else {
        return Ok(true);
    };
    let claimed = sqlx::query("UPDATE request_spool SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'")
        .bind(chrono::Utc::now().to_rfc3339()).bind(&id)
        .execute(db).await.map_err(internal)?.rows_affected();
    if claimed == 0 {
        return Ok(true);
    }
    let mut builder = Request::builder()
        .method(method.as_str())
        .uri(path.as_str());
    if let Some(value) = content_type {
        builder = builder.header(header::CONTENT_TYPE, value);
    }
    if let Some(value) = origin {
        builder = builder.header(header::ORIGIN, value);
    }
    let outcome = match builder.body(Body::from(body.unwrap_or_default())) {
        Ok(request) => REPLAY_MEMBER
            .scope(member, app.clone().oneshot(request))
            .await
            .ok(),
        Err(_) => None,
    };
    drop(permit);
    let finished = chrono::Utc::now().to_rfc3339();
    match outcome {
        Some(response) => {
            let status = response.status().as_u16();
            let kind = response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            let bytes = axum::body::to_bytes(response.into_body(), MAX_STORED_RESPONSE)
                .await
                .unwrap_or_else(|_| {
                    Bytes::from_static(b"{\"error\":\"Response too large to store\"}")
                });
            sqlx::query("UPDATE request_spool SET status = 'done', response_status = ?, response_type = ?, response_body = ?, body = NULL, finished_at = ? WHERE id = ?")
                .bind(i64::from(status)).bind(kind).bind(bytes.as_ref()).bind(&finished).bind(&id)
                .execute(db).await.map_err(internal)?;
            tracing::info!(
                component = "admission",
                operation = "replay",
                status,
                outcome = "done",
                "admission.request_replayed"
            );
        }
        None => {
            sqlx::query("UPDATE request_spool SET status = 'failed', body = NULL, finished_at = ? WHERE id = ?")
                .bind(&finished).bind(&id).execute(db).await.map_err(internal)?;
            tracing::error!(
                component = "admission",
                operation = "replay",
                outcome = "failed",
                "admission.request_failed"
            );
        }
    }
    Ok(true)
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

pub async fn spool_worker(admission: Arc<Admission>, app: axum::Router) {
    let mut idle_rounds = 0u32;
    loop {
        match run_next(&admission, &app).await {
            Ok(true) => continue,
            Ok(false) => {}
            Err(error) => tracing::error!(error = ?error.1, "admission.worker_error"),
        }
        idle_rounds += 1;
        if idle_rounds % CLEANUP_EVERY == 0 {
            if let Err(error) = cleanup(&admission.state.db).await {
                tracing::error!(error = ?error.1, "admission.cleanup_error");
            }
        }
        tokio::time::sleep(IDLE_POLL).await;
    }
}

/// GET /queue/{id}: 202 while waiting, then the stored response.
pub async fn queue_status(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    type Row = (
        String,
        Option<String>,
        i64,
        String,
        Option<i64>,
        Option<String>,
        Option<Vec<u8>>,
    );
    let row: Option<Row> = sqlx::query_as("SELECT status, member_id, priority, created_at, response_status, response_type, response_body FROM request_spool WHERE id = ?")
        .bind(&id).fetch_optional(&state.db).await.map_err(internal)?;
    let (status, member, class, created, response_status, kind, body) =
        row.ok_or(ApiError(StatusCode::NOT_FOUND, "Queued request not found"))?;
    if let Some(owner) = member {
        let viewer = auth::viewer(&state, &headers).await?;
        if viewer.id != owner {
            return Err(ApiError(StatusCode::NOT_FOUND, "Queued request not found"));
        }
    }
    if status == "queued" || status == "running" {
        let (ahead,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM request_spool WHERE status = 'queued' AND (priority < ?1 OR (priority = ?1 AND created_at < ?2))")
            .bind(class).bind(&created).fetch_one(&state.db).await.map_err(internal)?;
        let mut response = (
            StatusCode::ACCEPTED,
            Json(json!({"queued": true, "status": status, "ahead": ahead})),
        )
            .into_response();
        response
            .headers_mut()
            .insert("x-queued", HeaderValue::from_static("1"));
        return Ok(response);
    }
    let result = if status == "done" {
        json!({"status": "done", "response": {"status": response_status, "contentType": kind, "body": STANDARD.encode(body.unwrap_or_default())}})
    } else {
        json!({"status": "failed", "error": "The queued request could not be completed"})
    };
    Ok((StatusCode::OK, Json(result)).into_response())
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
