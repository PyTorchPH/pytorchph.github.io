//! Canonical learning-program rows merged into managed site content until officers save them.
use crate::{ApiResult, internal};
use serde_json::{Map, Value, json};
use sqlx::SqlitePool;
use std::collections::HashSet;

type ProgramRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
);

// Mental model: normalize old event rows, then append only missing canonical curriculum entries.
pub(super) async fn merge(db: &SqlitePool, document: &mut Value) -> ApiResult<()> {
    let events = document["events"]
        .as_array_mut()
        .ok_or_else(|| internal("Published events are not an array"))?;
    let mut ids = HashSet::new();
    for event in events.iter_mut() {
        if let Some(object) = event.as_object_mut() {
            normalize_event(object);
            if let Some(id) = object.get("id").and_then(Value::as_str) {
                ids.insert(id.to_owned());
            }
        }
    }
    let rows: Vec<ProgramRow> = sqlx::query_as(
        "SELECT id,title,event_type,topic,starts_at,date_status,schedule_label,venue,registration_url,series,modules,photo_url FROM featured_learning_events WHERE active=1 ORDER BY sort_order,id",
    )
    .fetch_all(db)
    .await
    .map_err(internal)?;
    for (
        id,
        title,
        event_type,
        topic,
        starts_at,
        date_status,
        schedule_label,
        venue,
        registration_url,
        series,
        modules,
        photo_url,
    ) in rows
    {
        if ids.insert(id.clone()) {
            events.push(json!({
                "id":id, "title":title, "eventType":event_type, "topic":topic,
                "startsAt":starts_at, "dateStatus":date_status, "scheduleLabel":schedule_label,
                "venue":venue, "registrationUrl":registration_url, "series":series,
                "modules":modules, "photoUrl":photo_url,
            }));
        }
    }
    Ok(())
}

fn normalize_event(event: &mut Map<String, Value>) {
    for key in ["scheduleLabel", "series", "modules", "photoUrl"] {
        event
            .entry(key.to_owned())
            .or_insert_with(|| Value::String(String::new()));
    }
}
