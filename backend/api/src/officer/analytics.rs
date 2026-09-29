//! Officer Command Center figures computed from the database: member counts, upcoming
//! events, the weekly activity pulse, and review load per department.
//!
//! Module map (caller-first):
//!   overlay_dashboard           replaces the prototype analytics with live figures
//!   ├─ metrics                  total / active / inactive members and upcoming events
//!   │   ├─ count_members
//!   │   ├─ count_active_members activity or an unexpired session in ACTIVE_WINDOW_DAYS
//!   │   ├─ count_upcoming_events
//!   │   ├─ metric_json
//!   │   └─ inactive_trend
//!   ├─ activity                 events starting and contributions per day, last 7 days
//!   │   └─ day_pulse
//!   ├─ departments              open vs approved evidence reviews per department
//!   │   └─ claims_in
//!   └─ unavailable              placeholder for modules without live data
//!   scalar                      one COUNT query with a single bound value
use crate::{ApiResult, evidence::integrity::department, internal};
use chrono::{Datelike, Duration, NaiveDate, Utc};
use serde_json::{Value, json};
use sqlx::SqlitePool;

const ACTIVE_WINDOW_DAYS: i64 = 30;
// Sessions slide seven days past their last use, so an unexpired session means recent use.
const SESSION_DAYS: i64 = 7;
const PULSE_DAYS: i64 = 7;
const DEPARTMENTS: [(&str, &str); 5] = [
    ("secretariat", "Secretariat"),
    ("treasurer", "Treasurer"),
    ("external_relations", "External relations"),
    ("academics", "Academics"),
    ("executive", "Executive"),
];

// Mental model: the officer dashboard template keeps its layout; three modules get live
// numbers and every other module says "unavailable" rather than showing prototype data.
pub(crate) async fn overlay_dashboard(db: &SqlitePool, view: &mut Value) -> ApiResult<()> {
    let chapter_events = view
        .get("events")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    view["analytics"] = json!({
        "metrics": metrics(db, chapter_events).await?,
        "activity": activity(db).await?,
        "departments": departments(db).await?,
        "trust": unavailable(json!([])),
        "events": unavailable(json!({"planning": [], "approved": [], "live": [], "concluded": []})),
        "approvals": unavailable(json!([])),
        "leaderboard": unavailable(json!([])),
        "skills": unavailable(json!([])),
    });
    Ok(())
}

async fn metrics(db: &SqlitePool, chapter_events: usize) -> ApiResult<Value> {
    let now = Utc::now();
    let total = count_members(db).await?;
    let active = count_active_members(db).await?;
    let upcoming = count_upcoming_events(db, &now.to_rfc3339()).await? + chapter_events as i64;
    let inactive = (total - active).max(0);
    Ok(json!({"state": "live", "data": [
        metric_json("Total members", total, "approved members".into(), "up"),
        metric_json("Active members", active, format!("last {ACTIVE_WINDOW_DAYS} days"), "up"),
        metric_json("Inactive members", inactive, format!("no activity in {ACTIVE_WINDOW_DAYS} days"), inactive_trend(inactive, active)),
        metric_json("Upcoming events", upcoming, "open the events page".into(), "up"),
    ]}))
}

async fn count_members(db: &SqlitePool) -> ApiResult<i64> {
    let (total,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM members WHERE role != 'pending'")
        .fetch_one(db)
        .await
        .map_err(internal)?;
    Ok(total)
}

// Active: points or evidence in the window, or a session still alive from within it.
async fn count_active_members(db: &SqlitePool) -> ApiResult<i64> {
    let now = Utc::now();
    let since = (now - Duration::days(ACTIVE_WINDOW_DAYS)).to_rfc3339();
    // A session last used at `since` expires SESSION_DAYS later.
    let session_since = (now - Duration::days(ACTIVE_WINDOW_DAYS - SESSION_DAYS)).to_rfc3339();
    let (active,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM members m WHERE m.role != 'pending' AND ( \
           EXISTS (SELECT 1 FROM point_ledger l WHERE l.member_id = m.id AND julianday(l.created_at) >= julianday(?1)) \
           OR EXISTS (SELECT 1 FROM evidence_claims c WHERE c.member_id = m.id AND julianday(c.created_at) >= julianday(?1)) \
           OR EXISTS (SELECT 1 FROM sessions s WHERE s.member_id = m.id AND julianday(s.expires_at) >= julianday(?2)))",
    )
    .bind(&since)
    .bind(&session_since)
    .fetch_one(db)
    .await
    .map_err(internal)?;
    Ok(active)
}

async fn count_upcoming_events(db: &SqlitePool, now: &str) -> ApiResult<i64> {
    scalar(
        db,
        "SELECT COUNT(*) FROM events WHERE julianday(starts_at) >= julianday(?)",
        now,
    )
    .await
}

#[inline]
fn metric_json(label: &str, value: i64, delta: String, trend: &str) -> Value {
    json!({"label": label, "value": value.to_string(), "delta": delta, "trend": trend})
}

#[inline]
fn inactive_trend(inactive: i64, active: i64) -> &'static str {
    if inactive > active { "down" } else { "up" }
}

// Events starting and contributions (points awarded, evidence submitted) per day, last 7 days.
async fn activity(db: &SqlitePool) -> ApiResult<Value> {
    let today = Utc::now().date_naive();
    let mut days = Vec::new();
    for offset in (0..PULSE_DAYS).rev() {
        days.push(day_pulse(db, today - Duration::days(offset)).await?);
    }
    Ok(json!({"state": "live", "data": days}))
}

async fn day_pulse(db: &SqlitePool, day: NaiveDate) -> ApiResult<Value> {
    let key = day.format("%Y-%m-%d").to_string();
    let events = scalar(
        db,
        "SELECT COUNT(*) FROM events WHERE date(starts_at) = ?",
        &key,
    )
    .await?;
    let contributions = scalar(
        db,
        "SELECT (SELECT COUNT(*) FROM point_ledger WHERE date(created_at) = ?1 AND delta > 0) \
              + (SELECT COUNT(*) FROM evidence_claims WHERE date(created_at) = ?1)",
        &key,
    )
    .await?;
    Ok(json!({"day": day.weekday().to_string(), "events": events, "contributions": contributions}))
}

// Evidence reviews are routed to a department by claim kind: open = waiting, approved = done.
async fn departments(db: &SqlitePool) -> ApiResult<Value> {
    let rows: Vec<(String, String, i64)> =
        sqlx::query_as("SELECT kind, status, COUNT(*) FROM evidence_claims GROUP BY kind, status")
            .fetch_all(db)
            .await
            .map_err(internal)?;
    let load: Vec<Value> = DEPARTMENTS
        .iter()
        .map(|(key, label)| {
            json!({"department": label, "open": claims_in(&rows, key, "pending"), "approved": claims_in(&rows, key, "approved")})
        })
        .collect();
    Ok(json!({"state": "live", "data": load}))
}

#[inline]
fn claims_in(rows: &[(String, String, i64)], department_key: &str, status: &str) -> i64 {
    rows.iter()
        .filter(|(kind, row_status, _)| department(kind) == department_key && row_status == status)
        .map(|(_, _, count)| count)
        .sum()
}

#[inline]
fn unavailable(data: Value) -> Value {
    json!({"state": "unavailable", "data": data})
}

async fn scalar(db: &SqlitePool, sql: &'static str, bind: &str) -> ApiResult<i64> {
    let (value,): (i64,) = sqlx::query_as(sql)
        .bind(bind)
        .fetch_one(db)
        .await
        .map_err(internal)?;
    Ok(value)
}
