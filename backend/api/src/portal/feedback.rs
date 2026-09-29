//! Bug reports, stored as one organization-scoped list in portal_state.
//!
//! Module map (caller-first):
//!   feedback_rows                   the stored list
//!   read_feedback
//!   ├─ attach_kinds                 which attachments each report has
//!   └─ is_paginated_request
//!   create_feedback
//!   ├─ ensure_report_fields         exactly category, description, route, uiState
//!   ├─ is_valid_report              category, lengths, route, UI state
//!   │   └─ is_valid_ui_state
//!   └─ stamp_new_report             id, portal, status, reporter, timestamps
//!       └─ reporter_portal
//!   update_feedback
//!   ├─ ensure_officer
//!   ├─ is_valid_update
//!   └─ find_report
//!   note_feedback
//!   ├─ ensure_officer
//!   └─ find_report
use super::{
    fields::{field, limited},
    is_officer,
    store::{ORG, save, stored},
};
use crate::{ApiError, ApiResult, bad, feedback::attachments, identity::session::Viewer};
use axum::http::StatusCode;
use serde_json::{Map, Value, json};
use sqlx::SqlitePool;
use uuid::Uuid;

const FEEDBACK_KEY: &str = "/api/feedback";
const REPORT_FIELDS: [&str; 4] = ["category", "description", "route", "uiState"];
const CATEGORIES: [&str; 6] = [
    "bug",
    "broken_flow",
    "privacy",
    "security",
    "suggestion",
    "automatic_error",
];
const STATUSES: [&str; 5] = [
    "received",
    "triaged",
    "in_progress",
    "resolved",
    "dismissed",
];
const SEVERITIES: [&str; 4] = ["low", "medium", "high", "critical"];

pub(crate) async fn feedback_rows(db: &SqlitePool) -> ApiResult<Vec<Value>> {
    let value = stored(db, ORG, FEEDBACK_KEY)
        .await?
        .unwrap_or_else(|| json!([]));
    value
        .as_array()
        .cloned()
        .ok_or_else(|| bad("Feedback state invalid"))
}

// Mental model: officers see every report, members only their own; each report carries the
// kinds of attachments it has. The paginated shape is for the officer triage page only.
pub(crate) async fn read_feedback(
    db: &SqlitePool,
    actor: &Viewer,
    query: Option<&str>,
) -> ApiResult<Value> {
    let mut rows = feedback_rows(db).await?;
    attach_kinds(db, &mut rows).await?;
    if !is_officer(&actor.role) {
        rows.retain(|item| item.get("reporterId").and_then(Value::as_str) == Some(&actor.id));
    }
    if is_paginated_request(query) {
        if !is_officer(&actor.role) {
            return Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"));
        }
        return Ok(json!({"items":rows,"nextCursor":null}));
    }
    Ok(json!(rows))
}

async fn attach_kinds(db: &SqlitePool, rows: &mut [Value]) -> ApiResult<()> {
    let kinds = attachments::attachment_kinds(db).await?;
    for row in rows.iter_mut() {
        let id = row
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        row["attachments"] = json!(kinds.get(&id).cloned().unwrap_or_default());
    }
    Ok(())
}

#[inline]
fn is_paginated_request(query: Option<&str>) -> bool {
    query.is_some_and(|value| value.contains("paginated=1"))
}

// Mental model: accept only the four report fields, validate them, then add the server's
// own fields (id, status, reporter, timestamps) and put the report first in the list.
pub(crate) async fn create_feedback(
    db: &SqlitePool,
    actor: &Viewer,
    input: Value,
) -> ApiResult<Value> {
    ensure_report_fields(&input)?;
    let category = field(&input, "category")?;
    let route = field(&input, "route")?;
    let description = input
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");
    let ui = input
        .get("uiState")
        .and_then(Value::as_object)
        .ok_or_else(|| bad("Invalid feedback"))?;
    if !is_valid_report(category, description, route, ui) {
        return Err(bad("Invalid feedback"));
    }
    let id = Uuid::new_v4().to_string();
    let record = stamp_new_report(input, actor, &id)?;
    let mut rows = feedback_rows(db).await?;
    rows.insert(0, record);
    save(db, ORG, FEEDBACK_KEY, &json!(rows)).await?;
    Ok(json!({"id":id,"status":"received"}))
}

fn ensure_report_fields(input: &Value) -> ApiResult<()> {
    let fields = input.as_object().ok_or_else(|| bad("Invalid feedback"))?;
    if fields.len() != REPORT_FIELDS.len()
        || REPORT_FIELDS.iter().any(|key| !fields.contains_key(*key))
    {
        return Err(bad("Invalid feedback fields"));
    }
    Ok(())
}

fn is_valid_report(
    category: &str,
    description: &str,
    route: &str,
    ui: &Map<String, Value>,
) -> bool {
    CATEGORIES.contains(&category)
        && description.len() <= 1200
        && route.starts_with('/')
        && route.len() <= 240
        && is_valid_ui_state(ui)
}

// Title ≤160, online flag, viewport ≤32, ≤40 component markers of ≤120, optional error ≤300.
fn is_valid_ui_state(ui: &Map<String, Value>) -> bool {
    let title_ok = ui
        .get("title")
        .and_then(Value::as_str)
        .is_some_and(|value| value.len() <= 160);
    let online_ok = ui.get("online").and_then(Value::as_bool).is_some();
    let viewport_ok = ui
        .get("viewport")
        .and_then(Value::as_str)
        .is_some_and(|value| value.len() <= 32);
    let markers_ok = ui
        .get("componentMarkers")
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items.len() <= 40
                && items
                    .iter()
                    .all(|item| item.as_str().is_some_and(|text| text.len() <= 120))
        });
    let error_ok = ui
        .get("error")
        .is_none_or(|value| value.as_str().is_some_and(|text| text.len() <= 300));
    title_ok && online_ok && viewport_ok && markers_ok && error_ok
}

fn stamp_new_report(input: Value, actor: &Viewer, id: &str) -> ApiResult<Value> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut record = input;
    let object = record
        .as_object_mut()
        .ok_or_else(|| bad("Invalid feedback"))?;
    object.insert("id".into(), json!(id));
    object.insert("portal".into(), json!(reporter_portal(actor)));
    object.insert("status".into(), json!("received"));
    object.insert("severity".into(), json!("low"));
    object.insert("reporterId".into(), json!(actor.id));
    object.insert("reporterLabel".into(), json!(actor.display_name));
    object.insert("assignedTo".into(), Value::Null);
    object.insert("resolution".into(), Value::Null);
    object.insert("createdAt".into(), json!(now));
    object.insert("updatedAt".into(), json!(now));
    Ok(record)
}

#[inline]
fn reporter_portal(actor: &Viewer) -> &'static str {
    if is_officer(&actor.role) {
        "officer"
    } else {
        "member"
    }
}

// Mental model: officers triage a report by setting its status, severity, assignee and
// resolution; the whole list is saved back.
pub(crate) async fn update_feedback(
    db: &SqlitePool,
    actor: &Viewer,
    id: &str,
    input: Value,
) -> ApiResult<Value> {
    ensure_officer(actor)?;
    let status = field(&input, "status")?;
    let severity = field(&input, "severity")?;
    if !is_valid_update(status, severity, &input) {
        return Err(bad("Invalid feedback update"));
    }
    let mut rows = feedback_rows(db).await?;
    let row = find_report(&mut rows, id)?;
    row["status"] = json!(status);
    row["severity"] = json!(severity);
    row["assignedTo"] = input.get("assignedTo").cloned().unwrap_or(Value::Null);
    row["resolution"] = input.get("resolution").cloned().unwrap_or(Value::Null);
    row["updatedAt"] = json!(chrono::Utc::now().to_rfc3339());
    let result = row.clone();
    save(db, ORG, FEEDBACK_KEY, &json!(rows)).await?;
    Ok(result)
}

fn is_valid_update(status: &str, severity: &str, input: &Value) -> bool {
    let resolution_ok = input.get("resolution").is_none_or(|value| {
        value.is_null() || value.as_str().is_some_and(|text| text.len() <= 1200)
    });
    let assignee_ok = input.get("assignedTo").is_none_or(|value| {
        value.is_null()
            || value
                .as_str()
                .is_some_and(|text| Uuid::parse_str(text).is_ok())
    });
    STATUSES.contains(&status) && SEVERITIES.contains(&severity) && resolution_ok && assignee_ok
}

pub(crate) async fn note_feedback(
    db: &SqlitePool,
    actor: &Viewer,
    id: &str,
    input: Value,
) -> ApiResult<Value> {
    ensure_officer(actor)?;
    let body = field(&input, "body")?.trim();
    if !limited(body, 1200) {
        return Err(bad("Invalid feedback note"));
    }
    let mut rows = feedback_rows(db).await?;
    let row = find_report(&mut rows, id)?;
    let note = json!({"id":Uuid::new_v4().to_string(),"body":body,"actorId":actor.id,"createdAt":chrono::Utc::now().to_rfc3339()});
    if !row.get("notes").is_some_and(Value::is_array) {
        row["notes"] = json!([]);
    }
    row["notes"].as_array_mut().unwrap().push(note.clone());
    save(db, ORG, FEEDBACK_KEY, &json!(rows)).await?;
    Ok(note)
}

#[inline]
fn ensure_officer(actor: &Viewer) -> ApiResult<()> {
    if is_officer(&actor.role) {
        Ok(())
    } else {
        Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"))
    }
}

fn find_report<'a>(rows: &'a mut [Value], id: &str) -> ApiResult<&'a mut Value> {
    rows.iter_mut()
        .find(|value| value.get("id").and_then(Value::as_str) == Some(id))
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Feedback report not found"))
}
