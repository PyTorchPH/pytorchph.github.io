//! POST /evidence/{id}/review: an officer approves a pending claim with explicit points, or
//! rejects it. (The rubric-based review the portal uses lives in `evidence::review`.)
//!
//! Module map (caller-first):
//!   review_claim
//!   ├─ is_valid_review            approve needs 1..=1000 points, reject none; reason 4..=500
//!   ├─ load_claim_owner           the claim must still be pending
//!   ├─ ensure_not_own_claim
//!   ├─ mark_reviewed              guarded by status='pending'
//!   ├─ credit_points              approvals only
//!   │   ├─ insert_ledger_entry
//!   │   └─ queue_leaderboard_refresh
//!   └─ insert_audit_event
use crate::{
    ApiError, ApiResult, AppState, bad, check_origin,
    identity::session::{self, Viewer},
    internal,
};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use sqlx::SqliteConnection;
use std::sync::Arc;
use uuid::Uuid;

const MIN_REASON_BYTES: usize = 4;
const MAX_REASON_BYTES: usize = 500;
const MIN_POINTS: i64 = 1;
const MAX_POINTS: i64 = 1000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Review {
    decision: String,
    points: Option<i64>,
    reason: String,
}

impl Review {
    #[inline]
    fn is_approval(&self) -> bool {
        self.decision == "approve"
    }

    #[inline]
    fn resulting_status(&self) -> &'static str {
        if self.is_approval() {
            "approved"
        } else {
            "rejected"
        }
    }
}

// Mental model: validate the officer's decision, then in one transaction move the pending
// claim to approved or rejected, credit points for an approval, and audit the change.
pub async fn review_claim(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<Review>,
) -> ApiResult<StatusCode> {
    check_origin(&state, &headers)?;
    let officer = session::require_officer(&state, &headers).await?;
    if !is_valid_review(&input) {
        return Err(bad("Invalid evidence review"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    let member_id = load_claim_owner(&mut tx, &id).await?;
    ensure_not_own_claim(&officer, &member_id)?;
    let status = input.resulting_status();
    let now = chrono::Utc::now().to_rfc3339();
    mark_reviewed(&mut tx, &officer, &id, status, &input, &now).await?;
    if let Some(points) = input.points {
        credit_points(&mut tx, &officer, &member_id, &id, points, &now).await?;
    }
    insert_audit_event(&mut tx, &officer, &id, status, &now).await?;
    tx.commit().await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

fn is_valid_review(input: &Review) -> bool {
    matches!(input.decision.as_str(), "approve" | "reject")
        && is_valid_reason(&input.reason)
        && has_points_matching_decision(input)
}

#[inline]
fn is_valid_reason(reason: &str) -> bool {
    reason.trim().len() >= MIN_REASON_BYTES && reason.len() <= MAX_REASON_BYTES
}

// Approvals carry 1..=1000 points; rejections carry none.
#[inline]
fn has_points_matching_decision(input: &Review) -> bool {
    match input.decision.as_str() {
        "approve" => input
            .points
            .is_some_and(|points| (MIN_POINTS..=MAX_POINTS).contains(&points)),
        "reject" => input.points.is_none(),
        _ => true,
    }
}

async fn load_claim_owner(conn: &mut SqliteConnection, id: &str) -> ApiResult<String> {
    let owner: Option<(String,)> =
        sqlx::query_as("SELECT member_id FROM evidence_claims WHERE id=? AND status='pending'")
            .bind(id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(internal)?;
    let Some((member_id,)) = owner else {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "Claim is not pending",
        ));
    };
    Ok(member_id)
}

fn ensure_not_own_claim(officer: &Viewer, member_id: &str) -> ApiResult<()> {
    if member_id == officer.id {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Cannot review own evidence",
        ));
    }
    Ok(())
}

async fn mark_reviewed(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    id: &str,
    status: &str,
    input: &Review,
    now: &str,
) -> ApiResult<()> {
    let changed = sqlx::query("UPDATE evidence_claims SET status=?,points=?,reviewed_by=?,review_reason=?,reviewed_at=? WHERE id=? AND status='pending'")
        .bind(status).bind(input.points).bind(&officer.id).bind(input.reason.trim()).bind(now).bind(id)
        .execute(&mut *conn).await.map_err(internal)?.rows_affected();
    if changed != 1 {
        return Err(ApiError(StatusCode::PRECONDITION_FAILED, "Claim changed"));
    }
    Ok(())
}

async fn credit_points(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    member_id: &str,
    claim_id: &str,
    points: i64,
    now: &str,
) -> ApiResult<()> {
    insert_ledger_entry(conn, officer, member_id, claim_id, points, now).await?;
    queue_leaderboard_refresh(conn, now).await
}

async fn insert_ledger_entry(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    member_id: &str,
    claim_id: &str,
    points: i64,
    now: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO point_ledger(id,member_id,source_type,source_id,delta,actor_id,reason,created_at) VALUES (?,?, 'verified_evidence', ?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(member_id).bind(claim_id).bind(points)
        .bind(&officer.id).bind("officer_verified").bind(now).execute(&mut *conn).await.map_err(internal)?;
    Ok(())
}

async fn queue_leaderboard_refresh(conn: &mut SqliteConnection, now: &str) -> ApiResult<()> {
    sqlx::query("INSERT INTO jobs(id,kind,entity_id,status,available_at,created_at) VALUES (?,'leaderboard_refresh',?,'pending',?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET status='pending',generation=jobs.generation+1,available_at=excluded.available_at,result=NULL,finished_at=NULL")
        .bind(Uuid::new_v4().to_string()).bind("global").bind(now).bind(now).execute(&mut *conn).await.map_err(internal)?;
    Ok(())
}

async fn insert_audit_event(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    id: &str,
    status: &str,
    now: &str,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO audit_events(id,actor_id,operation,entity_id,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&officer.id)
    .bind(format!("evidence.{status}"))
    .bind(id)
    .bind(now)
    .execute(&mut *conn)
    .await
    .map_err(internal)?;
    Ok(())
}
