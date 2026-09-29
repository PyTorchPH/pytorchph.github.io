//! Member appeals against a leaderboard sanction, and the officer decision on each.
//!
//! Module map (caller-first):
//!   open_appeal                 a member contests their own active sanction
//!   ├─ ensure_valid_note
//!   ├─ ensure_active_sanction
//!   └─ insert_appeal            at most one open appeal per sanction
//!   officer_appeals             open appeals for officers (OfficerEvidenceAppeal)
//!   └─ officer_appeal_json
//!   resolve_appeal              restore (lift the sanction) or uphold
//!   ├─ AppealDecision::parse
//!   ├─ load_open_appeal
//!   ├─ ensure_not_own_appeal
//!   ├─ record_appeal_decision
//!   ├─ lift_sanction            restore only
//!   └─ insert_audit_event
//!   appeal_json                 one appeal in the portal shape (shared with sanctions)
use super::{
    claim_labels::member_label,
    request_fields::{is_valid_reason, trimmed_text},
};
use crate::{ApiError, ApiResult, bad, identity::session::Viewer, internal};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::{Row, SqliteConnection, SqlitePool, sqlite::SqliteRow};
use uuid::Uuid;

const MIN_NOTE_CHARS: usize = 10;
const MAX_NOTE_CHARS: usize = 1200;
/// Column where the appeal starts in an officer_appeals row.
const APPEAL_COLUMNS_START: usize = 4;

#[derive(Clone, Copy)]
enum AppealDecision {
    Restore,
    Uphold,
}

impl AppealDecision {
    fn parse(name: &str) -> Option<Self> {
        match name {
            "restore" => Some(Self::Restore),
            "uphold" => Some(Self::Uphold),
            _ => None,
        }
    }

    #[inline]
    fn resulting_state(self) -> &'static str {
        match self {
            Self::Restore => "restored",
            Self::Uphold => "upheld",
        }
    }

    #[inline]
    fn lifts_sanction(self) -> bool {
        matches!(self, Self::Restore)
    }
}

struct OpenAppeal {
    sanction_id: String,
    member_id: String,
}

pub(crate) fn appeal_json(row: &SqliteRow, offset: usize) -> Value {
    json!({
        "id": row.get::<String, _>(offset),
        "state": row.get::<String, _>(offset + 1),
        "note": row.get::<String, _>(offset + 2),
        "decisionReason": row.get::<Option<String>, _>(offset + 3),
        "createdAt": row.get::<String, _>(offset + 4),
        "decidedAt": row.get::<Option<String>, _>(offset + 5),
    })
}

// Mental model: a member may contest only their own active sanction, with a real note, and
// only once at a time; the database's one-open-appeal index enforces the last rule.
pub(crate) async fn open_appeal(
    db: &SqlitePool,
    member: &Viewer,
    input: &Value,
) -> ApiResult<Value> {
    let sanction_id = trimmed_text(input, "sanctionId");
    let note = trimmed_text(input, "note");
    ensure_valid_note(note)?;
    ensure_active_sanction(db, sanction_id, &member.id).await?;
    let id = insert_appeal(db, sanction_id, note).await?;
    tracing::info!(
        component = "integrity",
        operation = "open_appeal",
        "evidence.appeal_opened"
    );
    Ok(json!({ "appealId": id }))
}

#[inline]
fn is_valid_note(note: &str) -> bool {
    (MIN_NOTE_CHARS..=MAX_NOTE_CHARS).contains(&note.chars().count())
}

fn ensure_valid_note(note: &str) -> ApiResult<()> {
    if is_valid_note(note) {
        Ok(())
    } else {
        Err(bad("An appeal note of 10 to 1200 characters is required"))
    }
}

async fn ensure_active_sanction(
    db: &SqlitePool,
    sanction_id: &str,
    member_id: &str,
) -> ApiResult<()> {
    let active: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM leaderboard_sanctions WHERE id = ? AND member_id = ? AND lifted_at IS NULL",
    )
    .bind(sanction_id)
    .bind(member_id)
    .fetch_optional(db)
    .await
    .map_err(internal)?;
    match active {
        Some(_) => Ok(()),
        None => Err(ApiError(StatusCode::NOT_FOUND, "Active sanction not found")),
    }
}

async fn insert_appeal(db: &SqlitePool, sanction_id: &str, note: &str) -> ApiResult<String> {
    let id = Uuid::new_v4().to_string();
    let inserted = sqlx::query(
        "INSERT OR IGNORE INTO evidence_appeals(id,sanction_id,note,created_at) VALUES (?,?,?,?)",
    )
    .bind(&id)
    .bind(sanction_id)
    .bind(note)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(db)
    .await
    .map_err(internal)?
    .rows_affected();
    if inserted == 0 {
        return Err(ApiError(StatusCode::CONFLICT, "An appeal is already open"));
    }
    Ok(id)
}

pub(crate) async fn officer_appeals(db: &SqlitePool) -> ApiResult<Value> {
    let rows = sqlx::query(
        "SELECT s.id, s.claim_id, s.member_id, s.violation_type, \
                a.id, a.state, a.note, a.decision_reason, a.created_at, a.decided_at \
         FROM evidence_appeals a JOIN leaderboard_sanctions s ON s.id = a.sanction_id \
         WHERE a.state = 'open' ORDER BY a.created_at",
    )
    .fetch_all(db)
    .await
    .map_err(internal)?;
    Ok(Value::Array(rows.iter().map(officer_appeal_json).collect()))
}

fn officer_appeal_json(row: &SqliteRow) -> Value {
    let mut appeal = appeal_json(row, APPEAL_COLUMNS_START);
    appeal["sanctionId"] = json!(row.get::<String, _>(0));
    appeal["claimId"] = json!(row.get::<String, _>(1));
    appeal["memberLabel"] = json!(member_label(&row.get::<String, _>(2)));
    appeal["violationType"] = json!(row.get::<String, _>(3));
    appeal
}

/// Restoring an appeal lifts the sanction; upholding keeps it.
// Mental model: an officer other than the sanctioned member closes one open appeal; the
// decision, the optional sanction lift and the audit event land in one transaction.
pub(crate) async fn resolve_appeal(
    db: &SqlitePool,
    officer: &Viewer,
    appeal_id: &str,
    input: &Value,
) -> ApiResult<Value> {
    let decision = AppealDecision::parse(trimmed_text(input, "decision"));
    let reason = trimmed_text(input, "reason");
    let Some(decision) = decision.filter(|_| is_valid_reason(reason)) else {
        return Err(bad("Officer decision and reason required"));
    };
    let mut tx = db.begin().await.map_err(internal)?;
    let appeal = load_open_appeal(&mut tx, appeal_id).await?;
    ensure_not_own_appeal(officer, &appeal)?;
    let now = chrono::Utc::now().to_rfc3339();
    let state = decision.resulting_state();
    record_appeal_decision(&mut tx, officer, appeal_id, state, reason, &now).await?;
    if decision.lifts_sanction() {
        lift_sanction(&mut tx, officer, &appeal.sanction_id, &now).await?;
    }
    insert_audit_event(&mut tx, officer, appeal_id, state, &now).await?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "integrity",
        operation = "resolve_appeal",
        state,
        "evidence.appeal_resolved"
    );
    Ok(json!({ "id": appeal_id, "state": state }))
}

async fn load_open_appeal(conn: &mut SqliteConnection, appeal_id: &str) -> ApiResult<OpenAppeal> {
    let appeal: Option<(String, String)> = sqlx::query_as(
        "SELECT a.sanction_id, s.member_id FROM evidence_appeals a JOIN leaderboard_sanctions s ON s.id = a.sanction_id WHERE a.id = ? AND a.state = 'open'",
    )
    .bind(appeal_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(internal)?;
    let (sanction_id, member_id) =
        appeal.ok_or(ApiError(StatusCode::NOT_FOUND, "Open appeal not found"))?;
    Ok(OpenAppeal {
        sanction_id,
        member_id,
    })
}

fn ensure_not_own_appeal(officer: &Viewer, appeal: &OpenAppeal) -> ApiResult<()> {
    if appeal.member_id == officer.id {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Officers cannot decide their own appeal",
        ));
    }
    Ok(())
}

async fn record_appeal_decision(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    appeal_id: &str,
    state: &str,
    reason: &str,
    now: &str,
) -> ApiResult<()> {
    sqlx::query("UPDATE evidence_appeals SET state=?, decided_by=?, decision_reason=?, decided_at=? WHERE id=?")
        .bind(state).bind(&officer.id).bind(reason).bind(now).bind(appeal_id)
        .execute(&mut *conn).await.map_err(internal)?;
    Ok(())
}

async fn lift_sanction(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    sanction_id: &str,
    now: &str,
) -> ApiResult<()> {
    sqlx::query("UPDATE leaderboard_sanctions SET lifted_by=?, lifted_at=? WHERE id=?")
        .bind(&officer.id)
        .bind(now)
        .bind(sanction_id)
        .execute(&mut *conn)
        .await
        .map_err(internal)?;
    Ok(())
}

async fn insert_audit_event(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    appeal_id: &str,
    state: &str,
    now: &str,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO audit_events(id,actor_id,operation,entity_id,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&officer.id)
    .bind(format!("evidence.appeal.{state}"))
    .bind(appeal_id)
    .bind(now)
    .execute(&mut *conn)
    .await
    .map_err(internal)?;
    Ok(())
}
