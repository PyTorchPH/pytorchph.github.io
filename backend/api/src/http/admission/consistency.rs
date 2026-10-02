//! A write-preferring fence around live database views.
//!
//! Reads already in flight may finish. Once a write announces itself, later reads wait until
//! every announced or spooled write completes. A bounded retry count turns prolonged write
//! pressure into an actionable response instead of an indefinitely stale or blocked read.
use axum::{
    Json,
    http::{HeaderValue, StatusCode, header::RETRY_AFTER},
    response::{IntoResponse, Response},
};
use sqlx::SqlitePool;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;
use tokio::sync::{Notify, OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};

pub(crate) const MAX_READ_DEFERRALS: usize = 5;
const DEFERRAL_INTERVAL: Duration = Duration::from_millis(250);
const RETRY_AFTER_SECONDS: &str = "2";

pub(crate) struct ConsistencyFence {
    access: Arc<RwLock<()>>,
    pending_spooled_writes: AtomicUsize,
    changed: Notify,
}

pub(crate) enum AccessGuard {
    Read { _guard: OwnedRwLockReadGuard<()> },
    Write { _guard: WriteGuard },
}

pub(crate) struct WriteGuard {
    guard: Option<OwnedRwLockWriteGuard<()>>,
    fence: Arc<ConsistencyFence>,
}

impl ConsistencyFence {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self {
            access: Arc::new(RwLock::new(())),
            pending_spooled_writes: AtomicUsize::new(0),
            changed: Notify::new(),
        })
    }

    /// Mental model: every blocked observation is one deferral. Five observations return a
    /// retryable response so the browser can explain sustained write pressure to the user.
    pub(crate) async fn read(self: &Arc<Self>) -> Result<AccessGuard, usize> {
        let mut deferrals = 0;
        loop {
            let changed = self.changed.notified();
            if self.pending_spooled_writes.load(Ordering::Acquire) == 0
                && let Ok(guard) = self.access.clone().try_read_owned()
            {
                return Ok(AccessGuard::Read { _guard: guard });
            }

            deferrals += 1;
            tracing::info!(
                component = "admission",
                operation = "defer_read",
                deferrals,
                pending_spooled_writes = self.pending_spooled_writes.load(Ordering::Acquire),
                outcome = "waiting",
                "admission.read_deferred"
            );
            if deferrals >= MAX_READ_DEFERRALS {
                return Err(deferrals);
            }
            let _ = tokio::time::timeout(DEFERRAL_INTERVAL, changed).await;
        }
    }

    pub(crate) async fn write(self: &Arc<Self>) -> AccessGuard {
        self.changed.notify_waiters();
        AccessGuard::Write {
            _guard: WriteGuard {
                guard: Some(self.access.clone().write_owned().await),
                fence: self.clone(),
            },
        }
    }

    /// Disk replay already follows durable arrival order. It ignores the pending-write counter
    /// but still takes a read guard, so the next replayed writer cannot overtake this read.
    pub(crate) async fn replay_read(self: &Arc<Self>) -> AccessGuard {
        AccessGuard::Read {
            _guard: self.access.clone().read_owned().await,
        }
    }

    pub(crate) fn register_spooled_write(&self) {
        let pending = self.pending_spooled_writes.fetch_add(1, Ordering::AcqRel) + 1;
        self.changed.notify_waiters();
        tracing::info!(
            component = "admission",
            operation = "register_spooled_write",
            pending,
            outcome = "registered",
            "admission.spooled_write_registered"
        );
    }

    pub(crate) fn complete_spooled_write(&self) {
        let pending = self
            .pending_spooled_writes
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                Some(value.saturating_sub(1))
            })
            .unwrap_or_default()
            .saturating_sub(1);
        self.changed.notify_waiters();
        tracing::info!(
            component = "admission",
            operation = "complete_spooled_write",
            pending,
            outcome = "completed",
            "admission.spooled_write_completed"
        );
    }

    pub(crate) async fn restore(&self, db: &SqlitePool) -> Result<(), sqlx::Error> {
        let pending: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM request_spool WHERE status IN ('queued','running') AND method != 'GET'",
        )
        .fetch_one(db)
        .await?;
        self.pending_spooled_writes
            .store(pending.max(0) as usize, Ordering::Release);
        self.changed.notify_waiters();
        tracing::info!(
            component = "admission",
            operation = "restore_write_fence",
            pending,
            outcome = "restored",
            "admission.write_fence_restored"
        );
        Ok(())
    }
}

impl Drop for WriteGuard {
    fn drop(&mut self) {
        drop(self.guard.take());
        self.fence.changed.notify_waiters();
    }
}

pub(crate) fn deferred_read_response(deferrals: usize) -> Response {
    let mut response = (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({
            "code": "read_deferred_by_writes",
            "error": "Maraming sabay-sabay na updates ngayon. Sandali lang at subukan ulit para makita ang pinakabagong data.",
            "deferrals": deferrals,
            "retryAfterSeconds": 2
        })),
    )
        .into_response();
    response
        .headers_mut()
        .insert(RETRY_AFTER, HeaderValue::from_static(RETRY_AFTER_SECONDS));
    response
}
