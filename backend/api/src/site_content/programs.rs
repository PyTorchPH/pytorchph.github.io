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

/// Public events are canonical event records; CMS drafts and legacy curriculum rows are excluded.
pub(crate) async fn canonical_public(db: &SqlitePool) -> ApiResult<Vec<Value>> {
    type Row = (
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        bool,
        String,
        String,
        String,
        String,
        String,
    );
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT e.id,e.title,e.category,e.starts_at,e.parent_id,e.published_at,p.is_demo,p.topic,p.venue,p.registration_url,p.series,p.description FROM events e JOIN event_publication p ON p.event_id=e.id WHERE p.is_public=1 ORDER BY e.starts_at ASC,e.id ASC LIMIT 100"
    ).fetch_all(db).await.map_err(internal)?;
    Ok(rows.into_iter().map(|(id,title,category,starts_at,parent_id,published_at,is_demo,topic,venue,registration_url,series,description)| {
        json!({"id":id,"title":title,"category":category,"eventType":category,
            "startsAt":starts_at,"parentId":parent_id,"publishedAt":published_at,
            "isDemo":is_demo,"topic":topic,"description":description,"venue":venue,"registrationUrl":registration_url,
            "series":series,"dateStatus":"confirmed","scheduleLabel":"","modules":"","photoUrl":null})
    }).collect())
}

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
