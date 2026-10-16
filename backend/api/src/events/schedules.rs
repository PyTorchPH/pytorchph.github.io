//! Published learning schedules, distinct from scored competitions. No content is seeded in source.
use crate::{ApiError, ApiResult, AppState, bad, identity::session::Viewer, internal};
use axum::http::StatusCode;
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{FromRow, SqlitePool};

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct NewSchedule {
    id: String,
    title: String,
    starts_at: String,
    series: String,
    modules: String,
    confirm: bool,
}

#[derive(FromRow)]
struct Schedule {
    id: String,
    title: String,
    starts_at: String,
    date_status: String,
    schedule_label: String,
    series: String,
    modules: String,
}

// Mental model: validate public metadata → require consent and publication grants → insert once → compare retries.
pub(crate) async fn create(state: &AppState, actor: &Viewer, input: Value) -> ApiResult<Value> {
    let input: NewSchedule =
        serde_json::from_value(input).map_err(|_| bad("Invalid schedule fields"))?;
    validate(&input)?;
    let (status, label) = schedule_date(&input.starts_at)?;
    let mut tx = state.db.begin().await.map_err(internal)?;
    super::publication_access::require_create(&mut tx, actor, true).await?;
    crate::ai_privacy::officer_consent_in(&mut tx, &actor.id).await?;
    let collision: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE id=?")
        .bind(&input.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    if collision != 0 {
        return Err(conflict());
    }
    let inserted = sqlx::query("INSERT INTO featured_learning_events(id,title,event_type,topic,starts_at,date_status,schedule_label,series,modules,sort_order,active) VALUES (?,?,'training',?,?,?,?,?,?,0,1) ON CONFLICT(id) DO NOTHING")
        .bind(&input.id).bind(input.title.trim()).bind(input.modules.trim()).bind(&input.starts_at)
        .bind(status).bind(&label).bind(input.series.trim()).bind(input.modules.trim())
        .execute(&mut *tx).await.map_err(internal)?.rows_affected() == 1;
    let row: Schedule = sqlx::query_as("SELECT id,title,starts_at,date_status,schedule_label,series,modules FROM featured_learning_events WHERE id=? AND active=1")
        .bind(&input.id).fetch_optional(&mut *tx).await.map_err(internal)?.ok_or_else(conflict)?;
    let event = project(row);
    if event["title"] != input.title.trim()
        || event["startsAt"] != input.starts_at
        || event["series"] != input.series.trim()
        || event["modules"] != input.modules.trim()
        || event["dateStatus"] != status
        || event["scheduleLabel"] != label
    {
        return Err(conflict());
    }
    if inserted {
        super::records::audit(&mut tx, &actor.id, "event.schedule_created", &input.id, 0).await?;
    }
    tx.commit().await.map_err(internal)?;
    tracing::info!(component="event_schedules", operation="create", created=inserted, event_id=%input.id, "events.schedule_saved");
    Ok(json!({"created":inserted,"event":event}))
}

pub(crate) async fn list(db: &SqlitePool, after: &str) -> ApiResult<Value> {
    if !after.is_empty() && !valid_id(after) {
        return Err(bad("Invalid schedule cursor"));
    }
    let mut events = public_rows(db, after, 21).await?;
    let more = events.len() > 20;
    events.truncate(20);
    let cursor = if more {
        events.last().map(|row| row["id"].clone())
    } else {
        None
    };
    Ok(json!({"view":"event_schedules","events":events,"nextCursor":cursor}))
}

pub(crate) async fn public_rows(db: &SqlitePool, after: &str, limit: i64) -> ApiResult<Vec<Value>> {
    let rows: Vec<Schedule> = sqlx::query_as("SELECT id,title,starts_at,date_status,schedule_label,series,modules FROM featured_learning_events WHERE active=1 AND id>? ORDER BY id LIMIT ?")
        .bind(after).bind(limit).fetch_all(db).await.map_err(internal)?;
    Ok(rows.into_iter().map(project).collect())
}

fn validate(input: &NewSchedule) -> ApiResult<()> {
    if !input.confirm || !valid_id(&input.id) {
        return Err(bad("Explicit schedule confirmation and valid ID required"));
    }
    for (value, maximum) in [
        (&input.title, 200),
        (&input.series, 200),
        (&input.modules, 1000),
    ] {
        if value.trim().is_empty() || value.len() > maximum || value.chars().any(char::is_control) {
            return Err(bad("Invalid public schedule text"));
        }
    }
    Ok(())
}

#[inline]
fn valid_id(value: &str) -> bool {
    (1..=80).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"-_".contains(&b))
}

fn schedule_date(value: &str) -> ApiResult<(&'static str, String)> {
    let month_only = value.len() == 7;
    let expanded = if month_only {
        format!("{value}-01")
    } else {
        value.to_owned()
    };
    if ![7, 10].contains(&value.len()) {
        return Err(bad("Use YYYY-MM or YYYY-MM-DD, without inventing a time"));
    }
    let date = NaiveDate::parse_from_str(&expanded, "%Y-%m-%d")
        .map_err(|_| bad("Invalid schedule date"))?;
    if date.format("%Y-%m-%d").to_string() != expanded {
        return Err(bad("Use a canonical schedule date"));
    }
    Ok(if month_only {
        ("tentative", date.format("%B %Y").to_string())
    } else {
        ("confirmed", date.format("%B %-d, %Y").to_string())
    })
}

fn project(row: Schedule) -> Value {
    // Legacy curriculum seeds used day 01 for a month-only label; never present that placeholder as an actual day.
    let starts_at = if row.date_status == "tentative"
        && row.starts_at.ends_with("-01")
        && schedule_date(row.starts_at.get(..7).unwrap_or(""))
            .is_ok_and(|(_, label)| label == row.schedule_label)
    {
        row.starts_at[..7].to_owned()
    } else {
        row.starts_at
    };
    json!({"id":row.id,"title":row.title,"startsAt":starts_at,"dateStatus":row.date_status,
        "scheduleLabel":row.schedule_label,"series":row.series,"modules":row.modules})
}

fn conflict() -> ApiError {
    tracing::warn!(
        component = "event_schedules",
        operation = "create",
        "events.schedule_conflict"
    );
    ApiError(
        StatusCode::CONFLICT,
        "Schedule ID already has different content; no record overwritten",
    )
}

#[cfg(test)]
mod tests;
