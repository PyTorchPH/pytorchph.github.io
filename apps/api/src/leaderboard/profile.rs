//! GET /api/member/leaderboard/profile: one ranked member's achievements.
//!
//! Module map (caller-first):
//!   member_profile              approved evidence and event placements of a ranked member
//!   ├─ find_ranked              the member's entry and rank in the season
//!   ├─ ensure_profile_visible   owner always; others only when the member shares achievements
//!   ├─ approved_evidence
//!   ├─ event_placements
//!   ├─ evidence_json            source links withheld for anonymous members
//!   │   └─ public_source_url
//!   └─ placement_json
use super::{
    params::query_param,
    seasons::{load_seasons, select_season},
    standings::{Entry, entry_json, standings},
    tiers::load_tiers,
};
use crate::{ApiError, ApiResult, identity::session::Viewer, internal};
use axum::http::StatusCode;
use chrono::Utc;
use serde_json::{Value, json};
use sqlx::SqlitePool;

/// Title, kind, points, reviewed at, source URL, verified level.
type EvidenceRow = (
    String,
    String,
    Option<i64>,
    Option<String>,
    String,
    Option<String>,
);
/// Event title, place, points, awarded at.
type PlacementRow = (String, Option<i64>, i64, String);

// Mental model: achievements are private by default. Find the member on the season board,
// check that the viewer may see them, then list approved evidence and event placements.
pub(crate) async fn member_profile(
    db: &SqlitePool,
    viewer: &Viewer,
    query: Option<&str>,
) -> ApiResult<Value> {
    let now = Utc::now();
    let target = query_param(query, "id").unwrap_or_default();
    let all_seasons = load_seasons(db).await?;
    let season = select_season(&all_seasons, query_param(query, "season").as_deref(), now);
    let tiers = load_tiers(db).await?;
    let ranked = standings(db, season, now).await?;
    let (rank, entry) = find_ranked(&ranked, &target)?;
    ensure_profile_visible(entry, &viewer.id)?;
    let evidence = approved_evidence(db, &entry.member_id).await?;
    let placements = event_placements(db, &entry.member_id).await?;
    Ok(json!({
        "standing": entry_json(entry, rank, &viewer.id, &tiers),
        "evidence": evidence.into_iter().map(|row| evidence_json(row, entry.anonymous)).collect::<Vec<_>>(),
        "placements": placements.into_iter().map(placement_json).collect::<Vec<_>>(),
    }))
}

fn find_ranked<'a>(ranked: &'a [Entry], member_id: &str) -> ApiResult<(usize, &'a Entry)> {
    ranked
        .iter()
        .enumerate()
        .find(|(_, entry)| entry.member_id == member_id)
        .map(|(index, entry)| (index + 1, entry))
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Member is not ranked"))
}

fn ensure_profile_visible(entry: &Entry, viewer: &str) -> ApiResult<()> {
    if !entry.is_profile_visible_to(viewer) {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "This member keeps achievements private",
        ));
    }
    Ok(())
}

async fn approved_evidence(db: &SqlitePool, member_id: &str) -> ApiResult<Vec<EvidenceRow>> {
    sqlx::query_as(
        "SELECT c.title, c.kind, c.points, c.reviewed_at, c.source_url, \
                (SELECT r.verified_level FROM evidence_claim_reviews r WHERE r.claim_id = c.id AND r.verified_level IS NOT NULL ORDER BY r.reviewed_at DESC LIMIT 1) \
         FROM evidence_claims c WHERE c.member_id = ? AND c.status = 'approved' ORDER BY c.reviewed_at DESC LIMIT 50",
    )
    .bind(member_id)
    .fetch_all(db)
    .await
    .map_err(internal)
}

async fn event_placements(db: &SqlitePool, member_id: &str) -> ApiResult<Vec<PlacementRow>> {
    sqlx::query_as(
        "SELECT e.title, l.place, l.delta, l.created_at FROM point_ledger l JOIN events e ON e.id = l.event_id \
         WHERE l.member_id = ? AND l.delta > 0 ORDER BY l.created_at DESC LIMIT 50",
    )
    .bind(member_id)
    .fetch_all(db)
    .await
    .map_err(internal)
}

fn evidence_json(
    (title, kind, points, reviewed_at, source_url, level): EvidenceRow,
    anonymous: bool,
) -> Value {
    json!({
        "title": title, "kind": kind, "level": level, "points": points.unwrap_or(0),
        "date": reviewed_at,
        "sourceUrl": public_source_url(source_url, anonymous),
    })
}

// Source links can identify an anonymous member, so they are withheld for anonymous rows.
#[inline]
fn public_source_url(source_url: String, anonymous: bool) -> Option<String> {
    (!anonymous && !source_url.is_empty()).then_some(source_url)
}

#[inline]
fn placement_json((event, place, points, at): PlacementRow) -> Value {
    json!({"event": event, "place": place, "points": points, "date": at})
}
