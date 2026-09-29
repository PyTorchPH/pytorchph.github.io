//! Attendance points from a Google Form that collects verified signed-in email.
//!
//! Module map (caller-first):
//!   import_google_form              one import of a form's responses for an event
//!   ├─ ensure_valid_import          form id shape and point range
//!   │   ├─ is_valid_google_id
//!   │   └─ is_valid_attendance_points
//!   ├─ load_started_event           the event's start time; it must already have started
//!   ├─ ensure_same_source           the form and points cannot change after the first import
//!   ├─ google_forms::*              token, verified-email check, all responses
//!   ├─ record_source                marks this import on the event's attendance source
//!   ├─ responses::record_response   classifies and records each response (see responses.rs)
//!   ├─ queue_leaderboard_refresh    only when someone earned points
//!   └─ record_import_audit
//!   read_attendance                 the source and awarded/unmatched counts for an event
//!   └─ count_responses
mod google_forms;
mod responses;

use crate::{ApiError, ApiResult, AppState, bad, check_origin, identity::session, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, FixedOffset};
use responses::{ImportContext, Tally, Tx};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportRequest {
    form_id: String,
    points: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    fetched: usize,
    awarded: usize,
    unmatched: usize,
    duplicates: usize,
    duplicate_members: usize,
    leaderboard_job_id: Option<String>,
}

// Mental model: check the request and the event before calling Google, then fetch every
// verified response and record each one inside a single transaction, tallying the outcomes.
// Re-importing is safe: recorded responses count as duplicates, unmatched ones may upgrade.
pub async fn import_google_form(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(event_id): Path<String>,
    Json(input): Json<ImportRequest>,
) -> ApiResult<Json<ImportResult>> {
    check_origin(&state, &headers)?;
    let actor = session::require_officer(&state, &headers).await?;
    ensure_valid_import(&input)?;
    let starts_at = load_started_event(&state.db, &event_id).await?;
    ensure_same_source(&state.db, &event_id, &input).await?;

    let token = google_forms::access_token(&state).await?;
    google_forms::require_verified_form(&state, &token, &input.form_id).await?;
    let form_responses = google_forms::fetch_responses(&state, &token, &input.form_id).await?;
    let fetched = form_responses.len();
    let now = chrono::Utc::now().to_rfc3339();
    let import = ImportContext {
        event_id: &event_id,
        form_id: &input.form_id,
        points: input.points,
        actor_id: &actor.id,
        now: &now,
        starts_at,
    };

    let mut tx = state.db.begin().await.map_err(internal)?;
    record_source(&mut tx, &import).await?;
    let mut tally = Tally::default();
    for response in &form_responses {
        tally.count(responses::record_response(&mut tx, &import, response).await?);
    }
    let job_id = if tally.awarded > 0 {
        queue_leaderboard_refresh(&mut tx, &now).await?
    } else {
        None
    };
    record_import_audit(&mut tx, &actor.id, &event_id, &now).await?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(event_id = %event_id, fetched, awarded = tally.awarded, unmatched = tally.unmatched, duplicates = tally.duplicates, duplicate_members = tally.duplicate_members, "attendance.imported");
    Ok(Json(ImportResult {
        fetched,
        awarded: tally.awarded,
        unmatched: tally.unmatched,
        duplicates: tally.duplicates,
        duplicate_members: tally.duplicate_members,
        leaderboard_job_id: job_id,
    }))
}

fn ensure_valid_import(input: &ImportRequest) -> ApiResult<()> {
    if !is_valid_google_id(&input.form_id) || !is_valid_attendance_points(input.points) {
        return Err(bad("Invalid attendance import configuration"));
    }
    Ok(())
}

#[inline]
fn is_valid_google_id(value: &str) -> bool {
    (8..=256).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[inline]
fn is_valid_attendance_points(points: i64) -> bool {
    (1..=1000).contains(&points)
}

async fn load_started_event(db: &SqlitePool, event_id: &str) -> ApiResult<DateTime<FixedOffset>> {
    let event_start: Option<(String,)> = sqlx::query_as("SELECT starts_at FROM events WHERE id=?")
        .bind(event_id)
        .fetch_optional(db)
        .await
        .map_err(internal)?;
    let Some((starts_at,)) = event_start else {
        return Err(ApiError(StatusCode::NOT_FOUND, "Event not found"));
    };
    let starts_at = DateTime::parse_from_rfc3339(&starts_at).map_err(internal)?;
    if starts_at > chrono::Utc::now() {
        return Err(bad("Attendance cannot be imported before the event starts"));
    }
    Ok(starts_at)
}

async fn ensure_same_source(
    db: &SqlitePool,
    event_id: &str,
    input: &ImportRequest,
) -> ApiResult<()> {
    let existing = sqlx::query("SELECT form_id,points FROM attendance_sources WHERE event_id=?")
        .bind(event_id)
        .fetch_optional(db)
        .await
        .map_err(internal)?;
    if let Some(row) = existing {
        if row.get::<String, _>(0) != input.form_id || row.get::<i64, _>(1) != input.points {
            return Err(bad("Attendance source is immutable after first import"));
        }
    }
    Ok(())
}

// The first import creates the source; later ones only move last_imported_at forward.
async fn record_source(tx: &mut Tx<'_>, import: &ImportContext<'_>) -> ApiResult<()> {
    let source_changed = sqlx::query("INSERT INTO attendance_sources(event_id,form_id,points,configured_by,created_at,last_imported_at) VALUES (?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET last_imported_at=excluded.last_imported_at WHERE attendance_sources.form_id=excluded.form_id AND attendance_sources.points=excluded.points")
        .bind(import.event_id).bind(import.form_id).bind(import.points)
        .bind(import.actor_id).bind(import.now).bind(import.now).execute(&mut **tx).await.map_err(internal)?.rows_affected();
    if source_changed != 1 {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "Attendance source changed",
        ));
    }
    Ok(())
}

async fn queue_leaderboard_refresh(tx: &mut Tx<'_>, now: &str) -> ApiResult<Option<String>> {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO jobs(id,kind,entity_id,status,available_at,created_at) VALUES (?,'leaderboard_refresh','global','pending',?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET status='pending',generation=generation+1,available_at=excluded.available_at,finished_at=NULL,result=NULL")
        .bind(&id).bind(now).bind(now).execute(&mut **tx).await.map_err(internal)?;
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM jobs WHERE kind='leaderboard_refresh' AND entity_id='global'",
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal)
}

async fn record_import_audit(
    tx: &mut Tx<'_>,
    actor_id: &str,
    event_id: &str,
    now: &str,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO audit_events(id,actor_id,operation,entity_id,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(actor_id)
    .bind("attendance.imported")
    .bind(event_id)
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(internal)?;
    Ok(())
}

pub async fn read_attendance(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(event_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let _ = session::require_officer(&state, &headers).await?;
    let source = sqlx::query(
        "SELECT form_id,points,last_imported_at FROM attendance_sources WHERE event_id=?",
    )
    .bind(&event_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    let Some(source) = source else {
        return Ok(Json(
            serde_json::json!({"source": null, "awarded": 0, "unmatched": 0}),
        ));
    };
    let awarded = count_responses(&state.db, &event_id, "awarded").await?;
    let unmatched = count_responses(&state.db, &event_id, "unmatched").await?;
    Ok(Json(
        serde_json::json!({"source": {"formId": source.get::<String, _>(0), "points": source.get::<i64, _>(1), "lastImportedAt": source.get::<Option<String>, _>(2)}, "awarded": awarded, "unmatched": unmatched}),
    ))
}

async fn count_responses(db: &SqlitePool, event_id: &str, status: &'static str) -> ApiResult<i64> {
    let sql = match status {
        "awarded" => {
            "SELECT COUNT(*) FROM attendance_responses WHERE event_id=? AND status='awarded'"
        }
        _ => "SELECT COUNT(*) FROM attendance_responses WHERE event_id=? AND status='unmatched'",
    };
    sqlx::query_scalar(sql)
        .bind(event_id)
        .fetch_one(db)
        .await
        .map_err(internal)
}
