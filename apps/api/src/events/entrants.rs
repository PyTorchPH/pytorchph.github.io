//! Registering an entrant (a person or a team) in a competitive event.
//!
//! Module map (caller-first):
//!   add_entrant                    validates, then stores the entrant and its members
//!   ├─ ensure_valid_entrant        name length, member count, no repeated member
//!   │   ├─ is_valid_entrant_name
//!   │   ├─ is_valid_member_count
//!   │   └─ has_repeated_member
//!   ├─ load_open_competition       entrant kind of a competitive event without published results
//!   ├─ ensure_team_size            an individual entrant has exactly one member
//!   ├─ insert_entrant
//!   └─ enter_member                an approved member joins the entrant once per event
//!       └─ ensure_member_approved
//!   conflict_as / is_unique_violation   map a unique-key clash to a readable 422
use super::records::{Created, Tx, audit};
use crate::{ApiError, ApiResult, AppState, bad, check_origin, identity::session, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use std::{collections::HashSet, sync::Arc};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewEntrant {
    pub name: String,
    pub member_ids: Vec<String>,
}

// Mental model: an officer names an entrant and lists approved members; the event must still
// be open (competitive, unpublished) and each member may enter it only once.
pub async fn add_entrant(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(event_id): Path<String>,
    Json(input): Json<NewEntrant>,
) -> ApiResult<(StatusCode, Json<Created>)> {
    check_origin(&state, &headers)?;
    let actor = session::require_officer(&state, &headers).await?;
    let name = input.name.trim();
    ensure_valid_entrant(name, &input.member_ids)?;
    let mut tx = state.db.begin().await.map_err(internal)?;
    let kind = load_open_competition(&mut tx, &event_id).await?;
    ensure_team_size(&kind, input.member_ids.len())?;
    let entrant_id = Uuid::new_v4().to_string();
    insert_entrant(&mut tx, &entrant_id, &event_id, name, &kind).await?;
    for member_id in &input.member_ids {
        enter_member(&mut tx, &entrant_id, &event_id, member_id).await?;
    }
    audit(&mut tx, &actor.id, "entrant.added", &event_id, 0).await?;
    tx.commit().await.map_err(internal)?;
    Ok((StatusCode::CREATED, Json(Created::first(entrant_id))))
}

fn ensure_valid_entrant(name: &str, member_ids: &[String]) -> ApiResult<()> {
    if !is_valid_entrant_name(name) || !is_valid_member_count(member_ids.len()) {
        return Err(bad("Invalid entrant"));
    }
    if has_repeated_member(member_ids) {
        return Err(bad("Duplicate member"));
    }
    Ok(())
}

#[inline]
fn is_valid_entrant_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 120
}

#[inline]
fn is_valid_member_count(count: usize) -> bool {
    (1..=100).contains(&count)
}

#[inline]
fn has_repeated_member(member_ids: &[String]) -> bool {
    member_ids.iter().collect::<HashSet<_>>().len() != member_ids.len()
}

async fn load_open_competition(tx: &mut Tx<'_>, event_id: &str) -> ApiResult<String> {
    let event: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT entrant_kind, published_at FROM events WHERE id = ? AND competitive = 1",
    )
    .bind(event_id)
    .fetch_optional(&mut **tx)
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
    Ok(kind)
}

fn ensure_team_size(kind: &str, member_count: usize) -> ApiResult<()> {
    if is_individual(kind) && member_count != 1 {
        return Err(bad("Individual entrant requires one member"));
    }
    Ok(())
}

#[inline]
fn is_individual(kind: &str) -> bool {
    kind == "individual"
}

async fn insert_entrant(
    tx: &mut Tx<'_>,
    entrant_id: &str,
    event_id: &str,
    name: &str,
    kind: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO entrants(id,event_id,name,kind) VALUES (?,?,?,?)")
        .bind(entrant_id)
        .bind(event_id)
        .bind(name)
        .bind(kind)
        .execute(&mut **tx)
        .await
        .map_err(conflict_as("Entrant name already used"))?;
    Ok(())
}

async fn enter_member(
    tx: &mut Tx<'_>,
    entrant_id: &str,
    event_id: &str,
    member_id: &str,
) -> ApiResult<()> {
    ensure_member_approved(tx, member_id).await?;
    sqlx::query("INSERT INTO entrant_members(entrant_id,event_id,member_id) VALUES (?,?,?)")
        .bind(entrant_id)
        .bind(event_id)
        .bind(member_id)
        .execute(&mut **tx)
        .await
        .map_err(conflict_as("Member already entered this event"))?;
    Ok(())
}

async fn ensure_member_approved(tx: &mut Tx<'_>, member_id: &str) -> ApiResult<()> {
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM members WHERE id = ? AND role != 'pending'")
            .bind(member_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(internal)?;
    if exists.is_none() {
        return Err(bad("Entrant member is not approved"));
    }
    Ok(())
}

// A unique-key clash becomes a readable 422; any other database error stays internal.
fn conflict_as(message: &'static str) -> impl FnOnce(sqlx::Error) -> ApiError {
    move |error| {
        if is_unique_violation(&error) {
            bad(message)
        } else {
            internal(error)
        }
    }
}

#[inline]
fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .is_some_and(|db| db.is_unique_violation())
}
