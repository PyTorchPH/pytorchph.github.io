//! Publishing (or correcting) the official results of a competitive event.
//!
//! Module map (caller-first):
//!   publish_results                 one revision of placements, points and a leaderboard refresh
//!   ├─ ensure_results_request       a reason and at least one placement
//!   │   └─ is_valid_reason
//!   ├─ load_competition             start time, last place and current results revision
//!   ├─ ensure_expected_revision     optimistic concurrency against the caller's revision
//!   ├─ ensure_event_started
//!   ├─ ensure_placements_fit        count, order, uniqueness and registered entrants
//!   │   ├─ count_entrants
//!   │   ├─ is_next_place
//!   │   └─ ensure_registered_entrant
//!   ├─ reverse_previous_results     negative ledger rows for the prior revision, old results cleared
//!   ├─ record_placement             result row plus points for every member of the entrant
//!   │   ├─ points_for_place
//!   │   └─ entrant_members
//!   ├─ advance_results_revision     compare-and-set of the event's revision
//!   └─ queue_leaderboard_refresh    one pending refresh job, returned by id
use super::records::{Created, LedgerEntry, Tx, audit};
use crate::{ApiError, ApiResult, AppState, bad, check_origin, identity::session, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::Row;
use std::{collections::HashSet, sync::Arc};
use uuid::Uuid;

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

/// The competitive event as the transaction sees it.
struct Competition {
    starts_at: String,
    last_place: i64,
    revision: i64,
}

// Mental model: results are versioned. Publishing revision N+1 first reverses every point of
// revision N, then awards the new placements, bumps the revision only if nobody else did,
// and queues one leaderboard refresh.
pub async fn publish_results(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(event_id): Path<String>,
    Json(input): Json<ResultInput>,
) -> ApiResult<Json<Created>> {
    check_origin(&state, &headers)?;
    let actor = session::require_officer(&state, &headers).await?;
    ensure_results_request(&input)?;
    let mut tx = state.db.begin().await.map_err(internal)?;
    let event = load_competition(&mut tx, &event_id).await?;
    ensure_expected_revision(&event, input.expected_revision)?;
    ensure_event_started(&event)?;
    ensure_placements_fit(&mut tx, &event_id, &event, &input.placements).await?;
    let next_revision = event.revision + 1;
    if event.revision > 0 {
        reverse_previous_results(&mut tx, &event_id, event.revision, next_revision, &actor.id)
            .await?;
    }
    for placement in &input.placements {
        record_placement(&mut tx, &event_id, placement, next_revision, &actor.id).await?;
    }
    let now = Utc::now().to_rfc3339();
    advance_results_revision(&mut tx, &event_id, event.revision, next_revision, &now).await?;
    audit(
        &mut tx,
        &actor.id,
        "results.published",
        &event_id,
        next_revision,
    )
    .await?;
    let job_id = queue_leaderboard_refresh(&mut tx, &now).await?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(actor_id = %actor.id, event_id = %event_id, revision = next_revision, "results.published");
    Ok(Json(Created {
        id: event_id,
        revision: next_revision,
        job_id: Some(job_id),
    }))
}

fn ensure_results_request(input: &ResultInput) -> ApiResult<()> {
    if !is_valid_reason(&input.reason) || input.placements.is_empty() {
        return Err(bad("Results require a reason and placements"));
    }
    Ok(())
}

#[inline]
fn is_valid_reason(reason: &str) -> bool {
    reason.trim().len() >= 4 && reason.len() <= 500
}

async fn load_competition(tx: &mut Tx<'_>, event_id: &str) -> ApiResult<Competition> {
    let event = sqlx::query(
        "SELECT starts_at,last_place,results_revision FROM events WHERE id = ? AND competitive = 1",
    )
    .bind(event_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal)?
    .ok_or(ApiError(
        StatusCode::NOT_FOUND,
        "Competitive event not found",
    ))?;
    Ok(Competition {
        starts_at: event.get(0),
        last_place: event.get(1),
        revision: event.get(2),
    })
}

fn ensure_expected_revision(event: &Competition, expected: i64) -> ApiResult<()> {
    if event.revision != expected {
        return Err(stale_revision());
    }
    Ok(())
}

#[inline]
fn stale_revision() -> ApiError {
    ApiError(StatusCode::PRECONDITION_FAILED, "Stale results revision")
}

fn ensure_event_started(event: &Competition) -> ApiResult<()> {
    let event_start = DateTime::parse_from_rfc3339(&event.starts_at)
        .map_err(internal)?
        .with_timezone(&Utc);
    if event_start > Utc::now() {
        return Err(bad("Cannot publish before event starts"));
    }
    Ok(())
}

// Placements must be strictly increasing, within the configured places, one per entrant,
// no more than there are entrants, and every winner must be registered for this event.
async fn ensure_placements_fit(
    tx: &mut Tx<'_>,
    event_id: &str,
    event: &Competition,
    placements: &[Placement],
) -> ApiResult<()> {
    let entrant_count = count_entrants(tx, event_id).await?;
    let placed = placements.len() as i64;
    if placed > entrant_count || placed > event.last_place {
        return Err(bad("Too many placements for eligible entrants"));
    }
    let mut seen_entrants = HashSet::new();
    let mut previous_place = 0;
    for placement in placements {
        if !is_next_place(placement.place, previous_place, event.last_place)
            || !seen_entrants.insert(&placement.entrant_id)
        {
            return Err(bad(
                "Placements must be ordered, unique, and within the configured range",
            ));
        }
        previous_place = placement.place;
        ensure_registered_entrant(tx, event_id, &placement.entrant_id).await?;
    }
    Ok(())
}

async fn count_entrants(tx: &mut Tx<'_>, event_id: &str) -> ApiResult<i64> {
    sqlx::query_scalar("SELECT COUNT(*) FROM entrants WHERE event_id = ?")
        .bind(event_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(internal)
}

#[inline]
fn is_next_place(place: i64, previous_place: i64, last_place: i64) -> bool {
    place > previous_place && place <= last_place
}

async fn ensure_registered_entrant(
    tx: &mut Tx<'_>,
    event_id: &str,
    entrant_id: &str,
) -> ApiResult<()> {
    let belongs: Option<(String,)> =
        sqlx::query_as("SELECT id FROM entrants WHERE id = ? AND event_id = ?")
            .bind(entrant_id)
            .bind(event_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(internal)?;
    if belongs.is_none() {
        return Err(bad("Winner is not a registered entrant"));
    }
    Ok(())
}

// Every positive award of the previous revision gets a matching negative correction row.
async fn reverse_previous_results(
    tx: &mut Tx<'_>,
    event_id: &str,
    revision: i64,
    next_revision: i64,
    actor_id: &str,
) -> ApiResult<()> {
    let prior: Vec<(String, String, i64, i64)> = sqlx::query_as("SELECT member_id,entrant_id,place,delta FROM point_ledger WHERE event_id = ? AND result_revision = ? AND delta > 0")
        .bind(event_id).bind(revision).fetch_all(&mut **tx).await.map_err(internal)?;
    for (member_id, entrant_id, place, points) in prior {
        LedgerEntry {
            member_id: &member_id,
            event_id,
            entrant_id: &entrant_id,
            place,
            delta: -points,
            revision: next_revision,
            actor_id,
            reason: "result_correction",
        }
        .insert(tx)
        .await?;
    }
    sqlx::query("DELETE FROM results WHERE event_id = ?")
        .bind(event_id)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}

async fn record_placement(
    tx: &mut Tx<'_>,
    event_id: &str,
    placement: &Placement,
    next_revision: i64,
    actor_id: &str,
) -> ApiResult<()> {
    let points = points_for_place(tx, event_id, placement.place).await?;
    sqlx::query("INSERT INTO results(event_id,place,entrant_id,revision) VALUES (?,?,?,?)")
        .bind(event_id)
        .bind(placement.place)
        .bind(&placement.entrant_id)
        .bind(next_revision)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    for member_id in entrant_members(tx, &placement.entrant_id).await? {
        if points > 0 {
            LedgerEntry {
                member_id: &member_id,
                event_id,
                entrant_id: &placement.entrant_id,
                place: placement.place,
                delta: points,
                revision: next_revision,
                actor_id,
                reason: "official_result",
            }
            .insert(tx)
            .await?;
        }
    }
    Ok(())
}

async fn points_for_place(tx: &mut Tx<'_>, event_id: &str, place: i64) -> ApiResult<i64> {
    sqlx::query_scalar("SELECT points FROM place_points WHERE event_id = ? AND place = ?")
        .bind(event_id)
        .bind(place)
        .fetch_one(&mut **tx)
        .await
        .map_err(internal)
}

async fn entrant_members(tx: &mut Tx<'_>, entrant_id: &str) -> ApiResult<Vec<String>> {
    let members: Vec<(String,)> =
        sqlx::query_as("SELECT member_id FROM entrant_members WHERE entrant_id = ?")
            .bind(entrant_id)
            .fetch_all(&mut **tx)
            .await
            .map_err(internal)?;
    Ok(members.into_iter().map(|(member_id,)| member_id).collect())
}

// Compare-and-set: the update only lands if the revision is still the one we read.
async fn advance_results_revision(
    tx: &mut Tx<'_>,
    event_id: &str,
    revision: i64,
    next_revision: i64,
    now: &str,
) -> ApiResult<()> {
    let changed = sqlx::query("UPDATE events SET results_revision = ?, published_at = ? WHERE id = ? AND results_revision = ?")
        .bind(next_revision).bind(now).bind(event_id).bind(revision).execute(&mut **tx).await.map_err(internal)?.rows_affected();
    if changed != 1 {
        return Err(stale_revision());
    }
    Ok(())
}

async fn queue_leaderboard_refresh(tx: &mut Tx<'_>, now: &str) -> ApiResult<String> {
    sqlx::query("INSERT INTO jobs(id,kind,entity_id,status,available_at,created_at) VALUES (?,'leaderboard_refresh',?,'pending',?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET status='pending',generation=jobs.generation+1,available_at=excluded.available_at,result=NULL,finished_at=NULL")
        .bind(Uuid::new_v4().to_string()).bind("global").bind(now).bind(now).execute(&mut **tx).await.map_err(internal)?;
    sqlx::query_scalar(
        "SELECT id FROM jobs WHERE kind='leaderboard_refresh' AND entity_id='global'",
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(internal)
}
