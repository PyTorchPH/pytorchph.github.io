//! GET /api/member/leaderboard: one page of season standings plus the filters around it.
//!
//! Module map (caller-first):
//!   member_leaderboard       season, standings, optional skill filter, one page, filter lists
//!   ├─ load_skills
//!   ├─ skill_label_for       the label of the requested skill slug
//!   ├─ skill_mix             share of ranked members holding each skill (community radar)
//!   │   └─ share_percent
//!   ├─ rank_and_filter       rank numbers from the full board, then the skill filter
//!   ├─ page_of
//!   ├─ season_json / season_summary_json
//!   └─ skill_json
use super::{
    params::{page, page_size, query_param, view},
    seasons::{Season, load_seasons, select_season},
    standings::{Entry, entry_json, standings},
    tiers::load_tiers,
};
use crate::{ApiResult, identity::session::Viewer, internal};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::time::Instant;

// Mental model: rank everyone in the chosen season first, so rank numbers never change when
// a skill filter or a page narrows the view; then cut the page and describe the filters.
pub(crate) async fn member_leaderboard(
    db: &SqlitePool,
    viewer: &Viewer,
    query: Option<&str>,
) -> ApiResult<Value> {
    let started = Instant::now();
    let now = Utc::now();
    let all_seasons = load_seasons(db).await?;
    let season = select_season(&all_seasons, query_param(query, "season").as_deref(), now);
    let tiers = load_tiers(db).await?;
    let skills = load_skills(db).await?;
    let (page, page_size, view) = (page(query), page_size(query), view(query));
    let skill_slug = query_param(query, "skill");
    let skill_label = skill_label_for(&skills, skill_slug.clone());

    let all = standings(
        db,
        season,
        now,
        skill_slug.as_deref().filter(|_| skill_label.is_some()),
        &view,
    )
    .await?;
    let skill_mix = skill_mix(&skills, &all);
    let ranked = rank_and_filter(all, skill_label.as_deref());
    let revision = leaderboard_revision(&ranked);
    let total_pages = ranked.len().div_ceil(page_size);
    let entries: Vec<Value> = page_of(&ranked, page, page_size)
        .map(|(rank, entry)| entry_json(entry, *rank, &viewer.id, &tiers, &view))
        .collect();
    tracing::info!(component="leaderboard",operation="detailed_read",duration_ms=started.elapsed().as_millis() as u64,ranked_count=ranked.len(),page_size,source="live",revision=%revision,"leaderboard.read_complete");
    Ok(json!({
        "season": season.map(|season| season_json(season, now)),
        "view": view,
        "entries": entries,
        "page": page,
        "pageSize": page_size,
        "total": ranked.len(),
        "totalPages": total_pages,
        "revision": revision,
        "skills": skills.iter().map(skill_json).collect::<Vec<_>>(),
        "seasons": all_seasons.iter().map(|season| season_summary_json(season, now)).collect::<Vec<_>>(),
        "skillMix": skill_mix,
        "meta": {"mode": "live", "label": "Live leaderboard", "maxStaleSeconds": 0, "readAfterWrite": "committed"},
    }))
}

async fn load_skills(db: &SqlitePool) -> ApiResult<Vec<(String, String)>> {
    sqlx::query_as("SELECT slug, label FROM skills ORDER BY label")
        .fetch_all(db)
        .await
        .map_err(internal)
}

fn skill_label_for(skills: &[(String, String)], slug: Option<String>) -> Option<String> {
    slug.and_then(|slug| {
        skills
            .iter()
            .find(|(candidate, _)| *candidate == slug)
            .map(|(_, label)| label.clone())
    })
}

fn skill_mix(skills: &[(String, String)], ranked: &[Entry]) -> Vec<Value> {
    skills
        .iter()
        .map(|(_, label)| {
            let holders = ranked
                .iter()
                .filter(|entry| entry.skills.contains(label))
                .count();
            json!({"skill": label, "score": share_percent(holders, ranked.len())})
        })
        .collect()
}

#[inline]
fn share_percent(holders: usize, total: usize) -> usize {
    (holders * 100).checked_div(total).unwrap_or(0)
}

fn rank_and_filter(all: Vec<Entry>, skill_label: Option<&str>) -> Vec<(usize, Entry)> {
    all.into_iter()
        .filter(|entry| skill_label.is_none_or(|_| entry.verified > 0 || entry.pending > 0))
        .enumerate()
        .map(|(index, entry)| (index + 1, entry))
        .collect()
}

pub(crate) async fn public_verified(db: &SqlitePool) -> ApiResult<Value> {
    let now = Utc::now();
    let seasons = load_seasons(db).await?;
    let season = select_season(&seasons, None, now);
    let entries = standings(db, season, now, None, "verified").await?;
    Ok(
        json!(entries.into_iter().take(100).enumerate().map(|(index,entry)|
        json!({"rank":index+1,"displayName":entry.label,"points":entry.verified})
    ).collect::<Vec<_>>()),
    )
}

fn leaderboard_revision(ranked: &[(usize, Entry)]) -> String {
    let mut digest = Sha256::new();
    for (rank, entry) in ranked {
        digest.update(rank.to_le_bytes());
        digest.update(entry.member_id.as_bytes());
        digest.update([0]);
        digest.update(entry.label.as_bytes());
        digest.update([0]);
        digest.update(entry.verified.to_le_bytes());
        digest.update(entry.pending.to_le_bytes());
        digest.update(entry.streak.to_le_bytes());
        for skill in &entry.skills {
            digest.update(skill.as_bytes());
            digest.update([0]);
        }
        digest.update([entry.anonymous as u8, entry.shares_achievements as u8]);
    }
    hex::encode(digest.finalize())
}

#[inline]
fn page_of(
    ranked: &[(usize, Entry)],
    page: usize,
    page_size: usize,
) -> impl Iterator<Item = &(usize, Entry)> {
    ranked.iter().skip((page - 1) * page_size).take(page_size)
}

fn season_json(season: &Season, now: DateTime<Utc>) -> Value {
    json!({"slug": season.slug, "label": season.label, "state": season.state(now), "startsAt": season.starts_at, "endsAt": season.ends_at})
}

fn season_summary_json(season: &Season, now: DateTime<Utc>) -> Value {
    json!({"slug": season.slug, "label": season.label, "state": season.state(now)})
}

#[inline]
fn skill_json((slug, label): &(String, String)) -> Value {
    json!({"slug": slug, "label": label})
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(points: i64) -> Entry {
        Entry {
            member_id: "member-1".into(),
            label: "Member".into(),
            verified: points,
            pending: 0,
            streak: 1,
            skills: vec!["Rust".into()],
            anonymous: false,
            shares_achievements: true,
        }
    }

    #[test]
    fn revision_changes_when_a_ranked_value_changes() {
        let first = leaderboard_revision(&[(1, entry(10))]);
        let second = leaderboard_revision(&[(1, entry(11))]);
        assert_ne!(first, second);
    }
}
