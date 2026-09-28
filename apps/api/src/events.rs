use crate::auth;
use crate::{ApiError, ApiResult, AppState, bad, check_origin, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::{collections::HashSet, sync::Arc};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewEvent {
    pub title: String,
    pub category: String,
    pub starts_at: String,
    pub parent_id: Option<String>,
    pub entrant_kind: Option<String>,
    pub place_points: Option<Vec<i64>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    pub id: String,
    pub revision: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
}

fn valid_category(value: &str) -> bool {
    matches!(
        value,
        "talk" | "workshop" | "hackathon" | "competitive" | "mini_contest"
    )
}

pub async fn create_event(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<NewEvent>,
) -> ApiResult<(StatusCode, Json<Created>)> {
    check_origin(&state, &headers)?;
    let actor = auth::require_officer(&state, &headers).await?;
    let title = input.title.trim();
    if title.len() < 3 || title.len() > 200 || !valid_category(&input.category) {
        return Err(bad("Invalid event title or category"));
    }
    let starts_at = DateTime::parse_from_rfc3339(&input.starts_at)
        .map_err(|_| bad("Invalid event start"))?
        .with_timezone(&Utc)
        .to_rfc3339();
    let competitive = input.place_points.is_some();
    if competitive {
        if !matches!(input.entrant_kind.as_deref(), Some("team" | "individual")) {
            return Err(bad("Entrant kind required"));
        }
        let points = input.place_points.as_ref().unwrap();
        if points.is_empty()
            || points.len() > i32::MAX as usize
            || points.iter().any(|value| *value < 0)
        {
            return Err(bad("Invalid placement points"));
        }
    } else if input.entrant_kind.is_some() {
        return Err(bad("Entrant kind requires placements"));
    }
    if (input.category == "mini_contest") != input.parent_id.is_some() {
        return Err(bad("Mini contest requires parent event"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    if let Some(parent_id) = &input.parent_id {
        let parent: Option<(String,)> =
            sqlx::query_as("SELECT category FROM events WHERE id = ? AND parent_id IS NULL")
                .bind(parent_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(internal)?;
        if !matches!(
            parent.as_ref().map(|row| row.0.as_str()),
            Some("talk" | "workshop")
        ) {
            return Err(bad("Mini contest parent must be a talk or workshop"));
        }
    }
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO events(id,parent_id,title,category,starts_at,competitive,entrant_kind,last_place,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(&id).bind(&input.parent_id).bind(title).bind(&input.category).bind(starts_at)
        .bind(competitive as i64).bind(&input.entrant_kind)
        .bind(input.place_points.as_ref().map(|items| items.len() as i64))
        .bind(&actor.id).bind(&now).execute(&mut *tx).await.map_err(internal)?;
    if let Some(points) = input.place_points {
        for (index, value) in points.iter().enumerate() {
            sqlx::query("INSERT INTO place_points(event_id,place,points) VALUES (?,?,?)")
                .bind(&id)
                .bind((index + 1) as i64)
                .bind(value)
                .execute(&mut *tx)
                .await
                .map_err(internal)?;
        }
    }
    audit(&mut tx, &actor.id, "event.created", &id, 0).await?;
    tx.commit().await.map_err(internal)?;
    Ok((
        StatusCode::CREATED,
        Json(Created {
            id,
            revision: 0,
            job_id: None,
        }),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewEntrant {
    pub name: String,
    pub member_ids: Vec<String>,
}

pub async fn add_entrant(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(event_id): Path<String>,
    Json(input): Json<NewEntrant>,
) -> ApiResult<(StatusCode, Json<Created>)> {
    check_origin(&state, &headers)?;
    let actor = auth::require_officer(&state, &headers).await?;
    let name = input.name.trim();
    if name.is_empty()
        || name.len() > 120
        || input.member_ids.is_empty()
        || input.member_ids.len() > 100
    {
        return Err(bad("Invalid entrant"));
    }
    let unique: HashSet<_> = input.member_ids.iter().collect();
    if unique.len() != input.member_ids.len() {
        return Err(bad("Duplicate member"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    let event: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT entrant_kind, published_at FROM events WHERE id = ? AND competitive = 1",
    )
    .bind(&event_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?;
    let Some((kind, published_at)) = event else {
        return Err(ApiError(
            StatusCode::NOT_FOUND,
            "Competitive event not found",
        ));
    };
    if published_at.is_some() {
        return Err(bad("Results already published"));
    }
    if kind == "individual" && input.member_ids.len() != 1 {
        return Err(bad("Individual entrant requires one member"));
    }
    let entrant_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO entrants(id,event_id,name,kind) VALUES (?,?,?,?)")
        .bind(&entrant_id)
        .bind(&event_id)
        .bind(name)
        .bind(&kind)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .is_some_and(|db| db.is_unique_violation())
            {
                bad("Entrant name already used")
            } else {
                internal(error)
            }
        })?;
    for member_id in input.member_ids {
        let exists: Option<(String,)> =
            sqlx::query_as("SELECT id FROM members WHERE id = ? AND role != 'pending'")
                .bind(&member_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(internal)?;
        if exists.is_none() {
            return Err(bad("Entrant member is not approved"));
        }
        sqlx::query("INSERT INTO entrant_members(entrant_id,event_id,member_id) VALUES (?,?,?)")
            .bind(&entrant_id)
            .bind(&event_id)
            .bind(&member_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| {
                if error
                    .as_database_error()
                    .is_some_and(|db| db.is_unique_violation())
                {
                    bad("Member already entered this event")
                } else {
                    internal(error)
                }
            })?;
    }
    audit(&mut tx, &actor.id, "entrant.added", &event_id, 0).await?;
    tx.commit().await.map_err(internal)?;
    Ok((
        StatusCode::CREATED,
        Json(Created {
            id: entrant_id,
            revision: 0,
            job_id: None,
        }),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Placement {
    pub place: i64,
    pub entrant_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultInput {
    pub expected_revision: i64,
    pub placements: Vec<Placement>,
    pub reason: String,
}

pub async fn publish_results(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(event_id): Path<String>,
    Json(input): Json<ResultInput>,
) -> ApiResult<Json<Created>> {
    check_origin(&state, &headers)?;
    let actor = auth::require_officer(&state, &headers).await?;
    if input.reason.trim().len() < 4 || input.reason.len() > 500 || input.placements.is_empty() {
        return Err(bad("Results require a reason and placements"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    let event = sqlx::query(
        "SELECT starts_at,last_place,results_revision FROM events WHERE id = ? AND competitive = 1",
    )
    .bind(&event_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?
    .ok_or(ApiError(
        StatusCode::NOT_FOUND,
        "Competitive event not found",
    ))?;
    let starts_at: String = event.get(0);
    let last_place: i64 = event.get(1);
    let revision: i64 = event.get(2);
    if revision != input.expected_revision {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "Stale results revision",
        ));
    }
    let event_start = DateTime::parse_from_rfc3339(&starts_at)
        .map_err(internal)?
        .with_timezone(&Utc);
    if event_start > Utc::now() {
        return Err(bad("Cannot publish before event starts"));
    }
    let entrant_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM entrants WHERE event_id = ?")
        .bind(&event_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    if input.placements.len() as i64 > entrant_count || input.placements.len() as i64 > last_place {
        return Err(bad("Too many placements for eligible entrants"));
    }
    let mut seen_entrants = HashSet::new();
    let mut previous_place = 0;
    for placement in &input.placements {
        if placement.place <= previous_place
            || placement.place > last_place
            || !seen_entrants.insert(&placement.entrant_id)
        {
            return Err(bad(
                "Placements must be ordered, unique, and within the configured range",
            ));
        }
        previous_place = placement.place;
        let belongs: Option<(String,)> =
            sqlx::query_as("SELECT id FROM entrants WHERE id = ? AND event_id = ?")
                .bind(&placement.entrant_id)
                .bind(&event_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(internal)?;
        if belongs.is_none() {
            return Err(bad("Winner is not a registered entrant"));
        }
    }
    let next_revision = revision + 1;
    if revision > 0 {
        let prior: Vec<(String, String, i64, i64)> = sqlx::query_as("SELECT member_id,entrant_id,place,delta FROM point_ledger WHERE event_id = ? AND result_revision = ? AND delta > 0")
            .bind(&event_id).bind(revision).fetch_all(&mut *tx).await.map_err(internal)?;
        for (member_id, entrant_id, place, points) in prior {
            insert_ledger(
                &mut tx,
                &member_id,
                &event_id,
                &entrant_id,
                place,
                -points,
                next_revision,
                &actor.id,
                "result_correction",
            )
            .await?;
        }
        sqlx::query("DELETE FROM results WHERE event_id = ?")
            .bind(&event_id)
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
    }
    for placement in &input.placements {
        let points: i64 =
            sqlx::query_scalar("SELECT points FROM place_points WHERE event_id = ? AND place = ?")
                .bind(&event_id)
                .bind(placement.place)
                .fetch_one(&mut *tx)
                .await
                .map_err(internal)?;
        sqlx::query("INSERT INTO results(event_id,place,entrant_id,revision) VALUES (?,?,?,?)")
            .bind(&event_id)
            .bind(placement.place)
            .bind(&placement.entrant_id)
            .bind(next_revision)
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
        let members: Vec<(String,)> =
            sqlx::query_as("SELECT member_id FROM entrant_members WHERE entrant_id = ?")
                .bind(&placement.entrant_id)
                .fetch_all(&mut *tx)
                .await
                .map_err(internal)?;
        for (member_id,) in members {
            if points > 0 {
                insert_ledger(
                    &mut tx,
                    &member_id,
                    &event_id,
                    &placement.entrant_id,
                    placement.place,
                    points,
                    next_revision,
                    &actor.id,
                    "official_result",
                )
                .await?;
            }
        }
    }
    let now = Utc::now().to_rfc3339();
    let changed = sqlx::query("UPDATE events SET results_revision = ?, published_at = ? WHERE id = ? AND results_revision = ?")
        .bind(next_revision).bind(&now).bind(&event_id).bind(revision).execute(&mut *tx).await.map_err(internal)?.rows_affected();
    if changed != 1 {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "Stale results revision",
        ));
    }
    audit(
        &mut tx,
        &actor.id,
        "results.published",
        &event_id,
        next_revision,
    )
    .await?;
    sqlx::query("INSERT INTO jobs(id,kind,entity_id,status,available_at,created_at) VALUES (?,'leaderboard_refresh',?,'pending',?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET status='pending',generation=jobs.generation+1,available_at=excluded.available_at,result=NULL,finished_at=NULL")
        .bind(Uuid::new_v4().to_string()).bind("global").bind(&now).bind(&now).execute(&mut *tx).await.map_err(internal)?;
    let job_id: String = sqlx::query_scalar(
        "SELECT id FROM jobs WHERE kind='leaderboard_refresh' AND entity_id='global'",
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(actor_id = %actor.id, event_id = %event_id, revision = next_revision, "results.published");
    Ok(Json(Created {
        id: event_id,
        revision: next_revision,
        job_id: Some(job_id),
    }))
}

async fn insert_ledger(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    member_id: &str,
    event_id: &str,
    entrant_id: &str,
    place: i64,
    delta: i64,
    revision: i64,
    actor_id: &str,
    reason: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO point_ledger(id,member_id,event_id,entrant_id,place,delta,result_revision,actor_id,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(member_id).bind(event_id).bind(entrant_id).bind(place).bind(delta)
        .bind(revision).bind(actor_id).bind(reason).bind(Utc::now().to_rfc3339())
        .execute(&mut **tx).await.map_err(internal)?;
    Ok(())
}

async fn audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    actor_id: &str,
    operation: &str,
    entity_id: &str,
    revision: i64,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO audit_events(id,actor_id,operation,entity_id,revision,created_at) VALUES (?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(actor_id).bind(operation).bind(entity_id).bind(revision)
        .bind(Utc::now().to_rfc3339()).execute(&mut **tx).await.map_err(internal)?;
    Ok(())
}

pub async fn read_event(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(event_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let _ = auth::require_officer(&state, &headers).await?;
    let event = sqlx::query("SELECT id,title,category,starts_at,competitive,entrant_kind,last_place,results_revision,published_at FROM events WHERE id = ?")
        .bind(&event_id).fetch_optional(&state.db).await.map_err(internal)?
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Event not found"))?;
    let points: Vec<(i64, i64)> =
        sqlx::query_as("SELECT place,points FROM place_points WHERE event_id = ? ORDER BY place")
            .bind(&event_id)
            .fetch_all(&state.db)
            .await
            .map_err(internal)?;
    let results: Vec<(i64, String)> =
        sqlx::query_as("SELECT place,entrant_id FROM results WHERE event_id = ? ORDER BY place")
            .bind(&event_id)
            .fetch_all(&state.db)
            .await
            .map_err(internal)?;
    Ok(Json(serde_json::json!({
        "id": event.get::<String, _>(0), "title": event.get::<String, _>(1),
        "category": event.get::<String, _>(2), "startsAt": event.get::<String, _>(3),
        "competitive": event.get::<i64, _>(4) == 1, "entrantKind": event.get::<Option<String>, _>(5),
        "lastPlace": event.get::<Option<i64>, _>(6), "revision": event.get::<i64, _>(7),
        "publishedAt": event.get::<Option<String>, _>(8), "placePoints": points, "results": results
    })))
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
}

pub async fn list_events(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<EventListItem>>> {
    let _ = auth::require_officer(&state, &headers).await?;
    let rows: Vec<(String, String, String, String, i64, Option<String>)> = sqlx::query_as(
        "SELECT id,title,category,starts_at,results_revision,published_at FROM events ORDER BY created_at DESC LIMIT 100"
    ).fetch_all(&state.db).await.map_err(internal)?;
    Ok(Json(
        rows.into_iter()
            .map(
                |(id, title, category, starts_at, revision, published_at)| EventListItem {
                    id,
                    title,
                    category,
                    starts_at,
                    revision,
                    published_at,
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
    let _ = auth::require_officer(&state, &headers).await?;
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id,name,kind FROM entrants WHERE event_id = ? ORDER BY name LIMIT 1000",
    )
    .bind(&event_id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    let mut views = Vec::with_capacity(rows.len());
    for (id, name, kind) in rows {
        let members: Vec<(String,)> =
            sqlx::query_as("SELECT member_id FROM entrant_members WHERE entrant_id = ?")
                .bind(&id)
                .fetch_all(&state.db)
                .await
                .map_err(internal)?;
        views.push(EntrantView {
            id,
            name,
            kind,
            member_ids: members.into_iter().map(|row| row.0).collect(),
        });
    }
    Ok(Json(views))
}
