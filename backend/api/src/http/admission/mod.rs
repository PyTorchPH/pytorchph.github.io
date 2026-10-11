//! Admission control ("the bouncer"). A fixed number of requests run at once; the rest wait
//! in a RAM priority queue (binary heap: lower class first, then arrival order). When that
//! queue is full, requests are written to an on-disk spool (SQLite) and answered at once with
//! 202 + a job id; spool workers replay them through the same router, highest priority first,
//! and store the response for the client to collect from GET /queue/{id}.
//! Auth requests never spill (their responses set cookies). Private photo requests reject a full
//! RAM queue so their bytes and responses never enter website SQLite. Limits come from the
//! environment (see Config::from_env).
//!
//! Module map (caller-first):
//!   admit                  middleware in front of every route
//!   ├─ priority            request class: bypass, auth, read, write, heavy
//!   ├─ gate                RAM slots + priority heap (Gate, Permit, Admit)
//!   └─ spool               overflow to disk, answered 202 (spool::spool)
//!   replay                 spool workers: run_next, spool_worker, recover, cleanup, replay_member
//!   status                 GET /queue/{id} and the /health figures
//!   Config::from_env       API_* limits
//!   Admission::new         wires the gate, config and state together
mod consistency;
mod gate;
mod replay;
mod spool;
mod status;

use crate::{ApiError, AppState};
use axum::{
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::sync::{Arc, OnceLock};

#[cfg(test)]
pub(crate) use consistency::{ConsistencyFence, MAX_READ_DEFERRALS};
pub(crate) use gate::{Admit, Gate};
pub(crate) use replay::{recover, replay_member, spool_worker};
// Driven step by step by the tests.
#[cfg(test)]
pub(crate) use replay::{cleanup, run_next};
pub(crate) use status::{health_figures, queue_status};

/// Request classes: lower is served first; BYPASS never queues.
const BYPASS: u8 = 0;
const AUTH: u8 = 1;
const READ: u8 = 2;
const WRITE: u8 = 3;
const HEAVY: u8 = 4;

#[derive(Clone, Debug)]
pub struct Config {
    pub max_inflight: usize,
    pub ram_queue_depth: usize,
    pub spool_max_bytes: i64,
    pub result_ttl_hours: i64,
    pub spool_workers: usize,
}

pub struct Admission {
    pub gate: Arc<Gate>,
    consistency: Arc<consistency::ConsistencyFence>,
    pub config: Config,
    pub state: Arc<AppState>,
}

// The running admission, so /health can report the gate without routing state.
static CURRENT: OnceLock<Arc<Admission>> = OnceLock::new();

/// Mental model: auth and bypass traffic preserve their priority. Data reads and writes first
/// cross a write-preferring consistency fence, then take a slot, wait, or spill to disk.
pub async fn admit(
    State(admission): State<Arc<Admission>>,
    request: Request,
    next: Next,
) -> Response {
    let class = priority(request.method(), request.uri().path());
    let is_read = request.method() == Method::GET;
    if class == BYPASS || is_replay() {
        return next.run(request).await;
    }
    let consistency = if class >= READ && is_read {
        match admission.consistency.read().await {
            Ok(guard) => Some(guard),
            Err(deferrals) => return consistency::deferred_read_response(deferrals),
        }
    } else if class >= READ {
        Some(admission.consistency.write().await)
    } else {
        None
    };
    let permit = match admission.gate.enter(class, may_spill(class)) {
        Admit::Now(permit) => permit,
        Admit::Wait(rx) => match rx.await {
            Ok(permit) => permit,
            Err(_) => {
                return ApiError(StatusCode::SERVICE_UNAVAILABLE, "Server is restarting")
                    .into_response();
            }
        },
        Admit::Full => {
            if is_private_photo_path(request.uri().path()) {
                tracing::warn!(
                    component = "admission",
                    operation = "private_photo_admission",
                    outcome = "rejected",
                    reason = "ram_queue_full",
                    "admission.private_photo_rejected"
                );
                let mut response = ApiError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Photo service busy; retry shortly",
                )
                .into_response();
                response
                    .headers_mut()
                    .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
                response.headers_mut().insert(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("private, no-store"),
                );
                return response;
            }
            return spool::spool(&admission, class, request)
                .await
                .unwrap_or_else(IntoResponse::into_response);
        }
    };
    let response = next.run(request).await;
    drop(permit);
    drop(consistency);
    response
}

#[inline]
fn is_private_photo_path(path: &str) -> bool {
    path == "/portal/api/member/organization-photo"
        || path == "/portal/api/member/organization-photo-consent"
        || path.starts_with("/portal/api/officer/organization/photo/")
}

/// Lower number = served first. 0 never queues.
pub fn priority(method: &Method, path: &str) -> u8 {
    if is_bypass(method, path) {
        return BYPASS;
    }
    if path.starts_with("/auth/") {
        return AUTH;
    }
    if is_heavy(path) {
        HEAVY
    } else if method == Method::GET {
        READ
    } else {
        WRITE
    }
}

#[inline]
fn is_bypass(method: &Method, path: &str) -> bool {
    method == Method::OPTIONS || path == "/health" || path.starts_with("/queue/")
}

#[inline]
fn is_heavy(path: &str) -> bool {
    path.contains("/attachments")
        || path.starts_with("/evidence/extension")
        || path.starts_with("/portal/media")
        || path.starts_with("/internal/")
}

// Auth responses set cookies, so auth waits in RAM instead of spilling.
#[inline]
fn may_spill(class: u8) -> bool {
    class >= READ
}

#[inline]
fn is_replay() -> bool {
    replay_member().is_some()
}

impl Config {
    /// API_MAX_INFLIGHT (default vCPUs × 2), API_RAM_QUEUE_DEPTH (64), API_SPOOL_MAX_MB (500),
    /// API_RESULT_TTL_HOURS (24), API_SPOOL_WORKERS (1).
    pub fn from_env() -> Self {
        let cpus = std::thread::available_parallelism().map_or(1, usize::from);
        Self {
            max_inflight: read_limit("API_MAX_INFLIGHT", (cpus * 2) as i64).max(1) as usize,
            ram_queue_depth: read_limit("API_RAM_QUEUE_DEPTH", 64) as usize,
            spool_max_bytes: read_limit("API_SPOOL_MAX_MB", 500) * 1024 * 1024,
            result_ttl_hours: read_limit("API_RESULT_TTL_HOURS", 24).max(1),
            spool_workers: read_limit("API_SPOOL_WORKERS", 1).max(1) as usize,
        }
    }
}

// A non-negative integer from the environment, or the default.
#[inline]
fn read_limit(name: &str, default: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse().ok())
        .filter(|value: &i64| *value >= 0)
        .unwrap_or(default)
}

impl Admission {
    pub fn new(config: Config, state: Arc<AppState>) -> Arc<Self> {
        let admission = Arc::new(Self {
            gate: Gate::new(config.max_inflight, config.ram_queue_depth),
            consistency: consistency::ConsistencyFence::new(),
            config,
            state,
        });
        let _ = CURRENT.set(admission.clone());
        admission
    }

    pub async fn restore_consistency(&self) -> Result<(), sqlx::Error> {
        self.consistency.restore(&self.state.db).await
    }
}
