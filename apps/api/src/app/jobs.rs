//! Durable background jobs (leaderboard refresh) and their status endpoint.
//!
//! Module map (caller-first):
//!   read_job                    GET /jobs/{id} for the job's owner or an admin
//!   run_job_worker              polls forever, one job at a time
//!   └─ process_one_job          claim → run by kind → record the outcome
//!      ├─ claim_next_job
//!      ├─ refresh_leaderboard_cache
//!      └─ mark_job_unsupported
use crate::{ApiError, ApiResult, AppState, identity::session, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Serialize;
use sqlx::SqlitePool;
use std::{sync::Arc, time::Duration};
use tracing::{error, info};

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const LEADERBOARD_REFRESH: &str = "leaderboard_refresh";

#[derive(Serialize)]
pub(crate) struct JobView {
    id: String,
    status: String,
    result: Option<String>,
}

pub(crate) async fn read_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<JobView>> {
    let actor = session::viewer(&state, &headers).await?;
    let row: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, status, result FROM jobs WHERE id = ? AND ((kind = 'leaderboard_refresh' AND ? != 'pending') OR entity_id IN (SELECT id FROM events WHERE created_by = ?) OR ? = 'admin')"
    ).bind(&id).bind(&actor.role).bind(&actor.id).bind(&actor.role).fetch_optional(&state.db).await.map_err(internal)?;
    let Some((id, status, result)) = row else {
        return Err(ApiError(StatusCode::NOT_FOUND, "Job not found"));
    };
    Ok(Json(JobView { id, status, result }))
}

// Mental model: a single background loop; a failed job is logged and the loop keeps going.
pub(crate) async fn run_job_worker(db: SqlitePool) {
    loop {
        if let Err(error) = process_one_job(&db).await {
            error!(error = %error, "worker.job_failed");
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

struct ClaimedJob {
    id: String,
    kind: String,
    generation: i64,
}

// Mental model: take the oldest due job, then run it by kind; the generation guards against
// a newer request for the same job overwriting this run's outcome.
pub(crate) async fn process_one_job(db: &SqlitePool) -> Result<(), sqlx::Error> {
    let Some(job) = claim_next_job(db).await? else {
        return Ok(());
    };
    if is_leaderboard_refresh(&job.kind) {
        refresh_leaderboard_cache(db, &job).await?;
        info!(job_id = %job.id, "worker.job_done");
    } else {
        mark_job_unsupported(db, &job).await?;
    }
    Ok(())
}

async fn claim_next_job(db: &SqlitePool) -> Result<Option<ClaimedJob>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let job: Option<(String, String, i64)> = sqlx::query_as(
        "SELECT id, kind, generation FROM jobs WHERE status = 'pending' AND available_at <= ? ORDER BY created_at LIMIT 1"
    ).bind(now()).fetch_optional(&mut *tx).await?;
    let Some((id, kind, generation)) = job else {
        return Ok(None);
    };
    sqlx::query("UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Some(ClaimedJob {
        id,
        kind,
        generation,
    }))
}

// Rebuilds the cached totals from the point ledger in one transaction.
async fn refresh_leaderboard_cache(db: &SqlitePool, job: &ClaimedJob) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM leaderboard_cache")
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO leaderboard_cache(member_id, points, refreshed_at) SELECT member_id, SUM(delta), ? FROM point_ledger GROUP BY member_id")
        .bind(now()).execute(&mut *tx).await?;
    sqlx::query("UPDATE jobs SET status = 'done', finished_at = ?, result = 'refreshed' WHERE id = ? AND generation = ?")
        .bind(now()).bind(&job.id).bind(job.generation)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

async fn mark_job_unsupported(db: &SqlitePool, job: &ClaimedJob) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE jobs SET status = 'failed', finished_at = ?, result = 'Unsupported job type' WHERE id = ? AND generation = ?")
        .bind(now()).bind(&job.id).bind(job.generation).execute(db).await?;
    Ok(())
}

#[inline]
fn is_leaderboard_refresh(kind: &str) -> bool {
    kind == LEADERBOARD_REFRESH
}

#[inline]
fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
