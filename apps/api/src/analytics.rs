//! Officer Command Center figures computed from the database: member counts, upcoming
//! events, the weekly activity pulse, and review load per department.
use crate::{ApiResult, integrity::department, internal};
use chrono::{Datelike, Duration, Utc};
use serde_json::{Value, json};
use sqlx::SqlitePool;

const ACTIVE_WINDOW_DAYS: i64 = 30;
// Sessions slide seven days past their last use, so an unexpired session means recent use.
const SESSION_DAYS: i64 = 7;
const DEPARTMENTS: [(&str, &str); 5] = [
    ("secretariat", "Secretariat"),
    ("treasurer", "Treasurer"),
    ("external_relations", "External relations"),
    ("academics", "Academics"),
    ("executive", "Executive"),
];

async fn scalar(db: &SqlitePool, sql: &'static str, bind: &str) -> ApiResult<i64> {
    let (value,): (i64,) = sqlx::query_as(sql)
        .bind(bind)
        .fetch_one(db)
        .await
        .map_err(internal)?;
    Ok(value)
}

async fn metrics(db: &SqlitePool, chapter_events: usize) -> ApiResult<Value> {
    let now = Utc::now();
    let since = (now - Duration::days(ACTIVE_WINDOW_DAYS)).to_rfc3339();
    // A session last used at `since` expires SESSION_DAYS later.
    let session_since = (now - Duration::days(ACTIVE_WINDOW_DAYS - SESSION_DAYS)).to_rfc3339();
    let (total,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM members WHERE role != 'pending'")
        .fetch_one(db)
        .await
        .map_err(internal)?;
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
    let upcoming = scalar(
        db,
        "SELECT COUNT(*) FROM events WHERE julianday(starts_at) >= julianday(?)",
        &now.to_rfc3339(),
    )
    .await?
        + chapter_events as i64;
    let inactive = (total - active).max(0);
    Ok(json!({"state": "live", "data": [
        {"label": "Total members", "value": total.to_string(), "delta": "approved members", "trend": "up"},
        {"label": "Active members", "value": active.to_string(), "delta": format!("last {ACTIVE_WINDOW_DAYS} days"), "trend": "up"},
        {"label": "Inactive members", "value": inactive.to_string(), "delta": format!("no activity in {ACTIVE_WINDOW_DAYS} days"), "trend": if inactive > active { "down" } else { "up" }},
        {"label": "Upcoming events", "value": upcoming.to_string(), "delta": "open the events page", "trend": "up"},
    ]}))
}

// Events starting and contributions (points awarded, evidence submitted) per day, last 7 days.
async fn activity(db: &SqlitePool) -> ApiResult<Value> {
    let today = Utc::now().date_naive();
    let mut days = Vec::new();
    for offset in (0..7).rev() {
        let day = today - Duration::days(offset);
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
        days.push(json!({"day": day.weekday().to_string(), "events": events, "contributions": contributions}));
    }
    Ok(json!({"state": "live", "data": days}))
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
            let count = |status: &str| -> i64 {
                rows.iter()
                    .filter(|(kind, row_status, _)| {
                        department(kind) == *key && row_status == status
                    })
                    .map(|(_, _, n)| n)
                    .sum()
            };
            json!({"department": label, "open": count("pending"), "approved": count("approved")})
        })
        .collect();
    Ok(json!({"state": "live", "data": load}))
}

/// Live Command Center figures for officers. Modules without live data are reported as
/// unavailable instead of showing prototype numbers.
pub(crate) async fn overlay_dashboard(db: &SqlitePool, view: &mut Value) -> ApiResult<()> {
    let chapter_events = view
        .get("events")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let unavailable = |data: Value| json!({"state": "unavailable", "data": data});
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
