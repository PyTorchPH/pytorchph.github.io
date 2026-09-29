//! Leaderboard sanctions: imposed when an officer confirms falsification or tampering, shown
//! to the member as integrity cases until an appeal restores them.
//!
//! Module map (caller-first):
//!   impose_sanction          one active sanction per member for a confirmed violation
//!   member_integrity         the signed-in member's active sanctions with their latest appeal
//!   └─ integrity_case_json
//!      └─ latest_appeal_json
use super::{appeals::appeal_json, review::Violation};
use crate::{ApiResult, identity::session::Viewer, internal};
use serde_json::{Value, json};
use sqlx::{Row, SqliteConnection, SqlitePool, sqlite::SqliteRow};
use uuid::Uuid;

/// Column where the latest appeal starts in a member_integrity row.
const APPEAL_COLUMNS_START: usize = 4;

// INSERT OR IGNORE: a member already under an active sanction keeps that one.
pub(crate) async fn impose_sanction(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    member_id: &str,
    claim_id: &str,
    violation: Violation,
    reason: &str,
    now: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT OR IGNORE INTO leaderboard_sanctions(id,member_id,claim_id,violation_type,safe_reason,imposed_by,imposed_at) VALUES (?,?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(member_id).bind(claim_id).bind(violation.as_str())
        .bind(reason).bind(&officer.id).bind(now)
        .execute(&mut *conn).await.map_err(internal)?;
    Ok(())
}

/// Active sanctions of the signed-in member with their latest appeal.
pub(crate) async fn member_integrity(db: &SqlitePool, member_id: &str) -> ApiResult<Value> {
    let rows = sqlx::query(
        "SELECT s.id, s.claim_id, s.safe_reason, s.imposed_at, \
                a.id, a.state, a.note, a.decision_reason, a.created_at, a.decided_at \
         FROM leaderboard_sanctions s \
         LEFT JOIN evidence_appeals a ON a.id = (SELECT id FROM evidence_appeals WHERE sanction_id = s.id ORDER BY created_at DESC LIMIT 1) \
         WHERE s.member_id = ? AND s.lifted_at IS NULL ORDER BY s.imposed_at DESC",
    )
    .bind(member_id)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    Ok(Value::Array(rows.iter().map(integrity_case_json).collect()))
}

fn integrity_case_json(row: &SqliteRow) -> Value {
    json!({
        "sanctionId": row.get::<String, _>(0),
        "claimId": row.get::<String, _>(1),
        "reason": row.get::<String, _>(2),
        "imposedAt": row.get::<String, _>(3),
        "appeal": latest_appeal_json(row),
    })
}

// A sanction without any appeal yields null.
#[inline]
fn latest_appeal_json(row: &SqliteRow) -> Value {
    row.get::<Option<String>, _>(APPEAL_COLUMNS_START)
        .map(|_| appeal_json(row, APPEAL_COLUMNS_START))
        .unwrap_or(Value::Null)
}
