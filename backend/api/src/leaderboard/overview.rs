//! The signed-in member's overview: standing, weekly activity and community figures.
//!
//! Module map (caller-first):
//!   overlay_overview            fills the overview template with live values
//!   ├─ count_approved_evidence
//!   ├─ member_deltas
//!   ├─ weekly_activity          points per ISO week for the last ACTIVITY_WEEKS weeks
//!   │   └─ points_in_week
//!   ├─ count_reviews / count_positive_awards
//!   ├─ apply_standing           rank, points, streak and even per-skill points split
//!   │   └─ points_per_skill
//!   └─ community_json
use super::{
    seasons::{current_week, load_seasons, parse_time, select_season, week_index},
    standings::{Entry, entry_json, standings},
    tiers::{Tiers, load_tiers},
};
use crate::{ApiResult, identity::session::Viewer, internal};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::SqlitePool;

const ACTIVITY_WEEKS: i64 = 12;

// Mental model: rank the member in the active season, gather their ledger history and a few
// community counts, then overwrite only the live parts of the overview template.
pub(crate) async fn overlay_overview(
    db: &SqlitePool,
    viewer: &Viewer,
    overview: &mut Value,
) -> ApiResult<()> {
    let now = Utc::now();
    let all_seasons = load_seasons(db).await?;
    let season = select_season(&all_seasons, None, now);
    let tiers = load_tiers(db).await?;
    let ranked = standings(db, season, now).await?;
    let standing = ranked
        .iter()
        .position(|entry| entry.is_viewer(&viewer.id))
        .map(|index| (index + 1, ranked[index].clone()));
    let verified_evidence = count_approved_evidence(db, &viewer.id).await?;
    let deltas = member_deltas(db, &viewer.id).await?;
    let activity = weekly_activity(&deltas, now);
    let reviewed = count_reviews(db).await?;
    let point_events = count_positive_awards(db).await?;

    if let Some((rank, entry)) = &standing {
        apply_standing(overview, *rank, entry, &viewer.id, &tiers);
    }
    overview["summary"]["verifiedEvidence"] = json!(verified_evidence);
    overview["activity"] = json!(activity);
    overview["community"] = community_json(ranked.len(), point_events, reviewed, now);
    overview["meta"] = json!({"mode": "live", "label": "Live standing"});
    Ok(())
}

async fn count_approved_evidence(db: &SqlitePool, member_id: &str) -> ApiResult<i64> {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM evidence_claims WHERE member_id = ? AND status = 'approved'",
    )
    .bind(member_id)
    .fetch_one(db)
    .await
    .map_err(internal)?;
    Ok(count)
}

async fn member_deltas(db: &SqlitePool, member_id: &str) -> ApiResult<Vec<(i64, String)>> {
    sqlx::query_as("SELECT delta, created_at FROM point_ledger WHERE member_id = ?")
        .bind(member_id)
        .fetch_all(db)
        .await
        .map_err(internal)
}

// W1 is the oldest week shown, W{ACTIVITY_WEEKS} is the current week.
fn weekly_activity(deltas: &[(i64, String)], now: DateTime<Utc>) -> Vec<Value> {
    let this_week = current_week(now);
    (0..ACTIVITY_WEEKS)
        .map(|offset| {
            let week = this_week - (ACTIVITY_WEEKS - 1 - offset);
            json!({"week": format!("W{}", offset + 1), "points": points_in_week(deltas, week)})
        })
        .collect()
}

#[inline]
fn points_in_week(deltas: &[(i64, String)], week: i64) -> i64 {
    deltas
        .iter()
        .filter(|(_, at)| parse_time(at).is_some_and(|at| week_index(at) == week))
        .map(|(delta, _)| delta)
        .sum()
}

async fn count_reviews(db: &SqlitePool) -> ApiResult<i64> {
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM evidence_claim_reviews")
        .fetch_one(db)
        .await
        .map_err(internal)?;
    Ok(count)
}

async fn count_positive_awards(db: &SqlitePool) -> ApiResult<i64> {
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM point_ledger WHERE delta > 0")
        .fetch_one(db)
        .await
        .map_err(internal)?;
    Ok(count)
}

fn apply_standing(overview: &mut Value, rank: usize, entry: &Entry, viewer: &str, tiers: &Tiers) {
    overview["standing"] = entry_json(entry, rank, viewer, tiers);
    overview["summary"]["points"] = json!(entry.verified);
    overview["summary"]["rank"] = json!(rank);
    overview["summary"]["streak"] = json!(entry.streak);
    let share = points_per_skill(entry);
    overview["skillPoints"] = json!(
        entry
            .skills
            .iter()
            .map(|skill| json!({"skill": skill, "points": share}))
            .collect::<Vec<_>>()
    );
}

// Verified points split evenly across the member's verified skills.
#[inline]
fn points_per_skill(entry: &Entry) -> i64 {
    if entry.skills.is_empty() {
        0
    } else {
        entry.verified / entry.skills.len() as i64
    }
}

fn community_json(
    active_members: usize,
    point_events: i64,
    reviewed: i64,
    now: DateTime<Utc>,
) -> Value {
    json!({
        "activeMembers": active_members,
        "verifiedPointEvents": point_events,
        "reviewedEvidence": reviewed,
        "freshness": now.to_rfc3339(),
    })
}
