//! Officer reads of events and their entrants.
//!
//! Module map (caller-first):
//!   read_event          one event with its place points and published results
//!   ├─ place_points
//!   └─ published_results
//!   list_events         the 100 most recently created events
//!   list_entrants       entrants of an event with their member ids
//!   └─ entrant_member_ids
use crate::{ApiError, ApiResult, AppState, identity::session, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

pub async fn read_event(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(event_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let actor = session::require_officer(&state, &headers).await?;
    let event = sqlx::query("SELECT id,title,category,starts_at,competitive,entrant_kind,last_place,results_revision,published_at,COALESCE(created_by,'') FROM events WHERE id = ?")
        .bind(&event_id).fetch_optional(&state.db).await.map_err(internal)?
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Event not found"))?;
    let points = place_points(&state.db, &event_id).await?;
    let results = published_results(&state.db, &event_id).await?;
    let publication = read_publication(&state.db, &event_id).await?;
    let mut tx = state.db.begin().await.map_err(internal)?;
    let permissions = super::publication_access::permissions(
        &mut tx,
        &actor,
        &event.get::<String, _>(9),
        publication["isPublic"].as_bool().unwrap_or(false),
    )
    .await?;
    tx.commit().await.map_err(internal)?;
    Ok(Json(serde_json::json!({
        "id": event.get::<String, _>(0), "title": event.get::<String, _>(1),
        "category": event.get::<String, _>(2), "startsAt": event.get::<String, _>(3),
        "competitive": event.get::<i64, _>(4) == 1, "entrantKind": event.get::<Option<String>, _>(5),
        "lastPlace": event.get::<Option<i64>, _>(6), "revision": event.get::<i64, _>(7),
        "publishedAt": event.get::<Option<String>, _>(8), "placePoints": points, "results": results,
        "publication": publication
        ,"publicationPermissions": permissions
    })))
}

pub async fn read_permissions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    let actor = session::require_officer(&state, &headers).await?;
    let mut tx = state.db.begin().await.map_err(internal)?;
    let permissions =
        super::publication_access::permissions(&mut tx, &actor, &actor.id, false).await?;
    tx.commit().await.map_err(internal)?;
    Ok(Json(
        serde_json::json!({"canCreate":permissions.can_create,"canPublish":permissions.can_publish}),
    ))
}

async fn read_publication(db: &SqlitePool, event_id: &str) -> ApiResult<serde_json::Value> {
    type PublicationRow = (bool, bool, String, String, String, String, String);
    let row: Option<PublicationRow> = sqlx::query_as(
        "SELECT is_public,is_demo,description,topic,venue,registration_url,series FROM event_publication WHERE event_id=?"
    ).bind(event_id).fetch_optional(db).await.map_err(internal)?;
    let (is_public, is_demo, description, topic, venue, registration_url, series) =
        row.unwrap_or_default();
    Ok(
        serde_json::json!({"isPublic":is_public,"isDemo":is_demo,"description":description,
        "topic":topic,"venue":venue,"registrationUrl":registration_url,"series":series}),
    )
}

async fn place_points(db: &SqlitePool, event_id: &str) -> ApiResult<Vec<(i64, i64)>> {
    sqlx::query_as("SELECT place,points FROM place_points WHERE event_id = ? ORDER BY place")
        .bind(event_id)
        .fetch_all(db)
        .await
        .map_err(internal)
}

async fn published_results(db: &SqlitePool, event_id: &str) -> ApiResult<Vec<(i64, String)>> {
    sqlx::query_as("SELECT place,entrant_id FROM results WHERE event_id = ? ORDER BY place")
        .bind(event_id)
        .fetch_all(db)
        .await
        .map_err(internal)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventListItem {
    id: String,
    title: String,
    category: String,
    starts_at: String,
    revision: i64,
    published_at: Option<String>,
    is_public: bool,
    is_demo: bool,
}

type EventListRow = (
    String,
    String,
    String,
    String,
    i64,
    Option<String>,
    bool,
    bool,
);

pub async fn list_events(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<EventListItem>>> {
    let _ = session::require_officer(&state, &headers).await?;
    let rows: Vec<EventListRow> = sqlx::query_as(
        "SELECT e.id,e.title,e.category,e.starts_at,e.results_revision,e.published_at,COALESCE(p.is_public,0),COALESCE(p.is_demo,0) FROM events e LEFT JOIN event_publication p ON p.event_id=e.id ORDER BY e.created_at DESC LIMIT 100"
    ).fetch_all(&state.db).await.map_err(internal)?;
    Ok(Json(
        rows.into_iter()
            .map(
                |(id, title, category, starts_at, revision, published_at, is_public, is_demo)| {
                    EventListItem {
                        id,
                        title,
                        category,
                        starts_at,
                        revision,
                        published_at,
                        is_public,
                        is_demo,
                    }
                },
            )
            .collect(),
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrantView {
    id: String,
    name: String,
    kind: String,
    member_ids: Vec<String>,
}

pub async fn list_entrants(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(event_id): Path<String>,
) -> ApiResult<Json<Vec<EntrantView>>> {
    let _ = session::require_officer(&state, &headers).await?;
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id,name,kind FROM entrants WHERE event_id = ? ORDER BY name LIMIT 1000",
    )
    .bind(&event_id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    let mut views = Vec::with_capacity(rows.len());
    for (id, name, kind) in rows {
        let member_ids = entrant_member_ids(&state.db, &id).await?;
        views.push(EntrantView {
            id,
            name,
            kind,
            member_ids,
        });
    }
    Ok(Json(views))
}

async fn entrant_member_ids(db: &SqlitePool, entrant_id: &str) -> ApiResult<Vec<String>> {
    let members: Vec<(String,)> =
        sqlx::query_as("SELECT member_id FROM entrant_members WHERE entrant_id = ?")
            .bind(entrant_id)
            .fetch_all(db)
            .await
            .map_err(internal)?;
    Ok(members.into_iter().map(|row| row.0).collect())
}
