//! Creating an organization event, optionally competitive with points per place.
//!
//! Module map (caller-first):
//!   create_event                          validates, then stores the event and its place points
//!   ├─ ensure_valid_event                 title, category, start time, competition shape, parent rule
//!   │   ├─ is_valid_title
//!   │   ├─ is_valid_category
//!   │   ├─ parse_event_start
//!   │   ├─ ensure_competition_shape
//!   │   │   ├─ is_known_entrant_kind
//!   │   │   └─ are_valid_place_points
//!   │   └─ is_mini_contest
//!   ├─ ensure_parent_accepts_mini_contest a mini contest hangs off a top-level talk or workshop
//!   ├─ insert_event
//!   └─ insert_place_points
use super::records::{Created, Tx, audit};
use crate::{ApiResult, AppState, bad, check_origin, identity::session, internal};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::sync::Arc;
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

// Mental model: an officer describes an event; everything is validated before the
// transaction, then the event row, its place points and an audit row land together.
pub async fn create_event(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<NewEvent>,
) -> ApiResult<(StatusCode, Json<Created>)> {
    check_origin(&state, &headers)?;
    let actor = session::require_officer(&state, &headers).await?;
    let title = input.title.trim();
    let starts_at = ensure_valid_event(title, &input)?;
    let mut tx = state.db.begin().await.map_err(internal)?;
    if let Some(parent_id) = &input.parent_id {
        ensure_parent_accepts_mini_contest(&mut tx, parent_id).await?;
    }
    let id = Uuid::new_v4().to_string();
    insert_event(&mut tx, &id, title, &starts_at, &input, &actor.id).await?;
    if let Some(points) = &input.place_points {
        insert_place_points(&mut tx, &id, points).await?;
    }
    audit(&mut tx, &actor.id, "event.created", &id, 0).await?;
    tx.commit().await.map_err(internal)?;
    Ok((StatusCode::CREATED, Json(Created::first(id))))
}

/// Returns the normalized UTC start time once the request describes a valid event.
fn ensure_valid_event(title: &str, input: &NewEvent) -> ApiResult<String> {
    if !is_valid_title(title) || !is_valid_category(&input.category) {
        return Err(bad("Invalid event title or category"));
    }
    let starts_at = parse_event_start(&input.starts_at)?;
    ensure_competition_shape(input)?;
    if is_mini_contest(&input.category) != input.parent_id.is_some() {
        return Err(bad("Mini contest requires parent event"));
    }
    Ok(starts_at)
}

#[inline]
fn is_valid_title(title: &str) -> bool {
    (3..=200).contains(&title.len())
}

#[inline]
fn is_valid_category(value: &str) -> bool {
    matches!(
        value,
        "talk" | "workshop" | "hackathon" | "competitive" | "mini_contest"
    )
}

fn parse_event_start(value: &str) -> ApiResult<String> {
    Ok(DateTime::parse_from_rfc3339(value)
        .map_err(|_| bad("Invalid event start"))?
        .with_timezone(&Utc)
        .to_rfc3339())
}

// Competitive events carry an entrant kind and points per place; others carry neither.
fn ensure_competition_shape(input: &NewEvent) -> ApiResult<()> {
    match &input.place_points {
        Some(points) => {
            if !is_known_entrant_kind(input.entrant_kind.as_deref()) {
                return Err(bad("Entrant kind required"));
            }
            if !are_valid_place_points(points) {
                return Err(bad("Invalid placement points"));
            }
            Ok(())
        }
        None if input.entrant_kind.is_some() => Err(bad("Entrant kind requires placements")),
        None => Ok(()),
    }
}

#[inline]
fn is_known_entrant_kind(kind: Option<&str>) -> bool {
    matches!(kind, Some("team" | "individual"))
}

#[inline]
fn are_valid_place_points(points: &[i64]) -> bool {
    !points.is_empty()
        && points.len() <= i32::MAX as usize
        && points.iter().all(|value| *value >= 0)
}

#[inline]
fn is_mini_contest(category: &str) -> bool {
    category == "mini_contest"
}

async fn ensure_parent_accepts_mini_contest(tx: &mut Tx<'_>, parent_id: &str) -> ApiResult<()> {
    let parent: Option<(String,)> =
        sqlx::query_as("SELECT category FROM events WHERE id = ? AND parent_id IS NULL")
            .bind(parent_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(internal)?;
    if !matches!(
        parent.as_ref().map(|row| row.0.as_str()),
        Some("talk" | "workshop")
    ) {
        return Err(bad("Mini contest parent must be a talk or workshop"));
    }
    Ok(())
}

async fn insert_event(
    tx: &mut Tx<'_>,
    id: &str,
    title: &str,
    starts_at: &str,
    input: &NewEvent,
    actor_id: &str,
) -> ApiResult<()> {
    let competitive = input.place_points.is_some();
    let last_place = input.place_points.as_ref().map(|items| items.len() as i64);
    sqlx::query("INSERT INTO events(id,parent_id,title,category,starts_at,competitive,entrant_kind,last_place,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(id).bind(&input.parent_id).bind(title).bind(&input.category).bind(starts_at)
        .bind(competitive as i64).bind(&input.entrant_kind).bind(last_place)
        .bind(actor_id).bind(Utc::now().to_rfc3339()).execute(&mut **tx).await.map_err(internal)?;
    Ok(())
}

// Place 1 gets the first value, place 2 the second, and so on.
async fn insert_place_points(tx: &mut Tx<'_>, event_id: &str, points: &[i64]) -> ApiResult<()> {
    for (index, value) in points.iter().enumerate() {
        sqlx::query("INSERT INTO place_points(event_id,place,points) VALUES (?,?,?)")
            .bind(event_id)
            .bind((index + 1) as i64)
            .bind(value)
            .execute(&mut **tx)
            .await
            .map_err(internal)?;
    }
    Ok(())
}
