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
use sqlx::SqlitePool;

// Mental model: rank everyone in the chosen season first, so rank numbers never change when
// a skill filter or a page narrows the view; then cut the page and describe the filters.
pub(crate) async fn member_leaderboard(
    db: &SqlitePool,
    viewer: &Viewer,
    query: Option<&str>,
) -> ApiResult<Value> {
    let now = Utc::now();
    let all_seasons = load_seasons(db).await?;
    let season = select_season(&all_seasons, query_param(query, "season").as_deref(), now);
    let tiers = load_tiers(db).await?;
    let skills = load_skills(db).await?;
    let (page, page_size, view) = (page(query), page_size(query), view(query));
    let skill_label = skill_label_for(&skills, query_param(query, "skill"));

    let all = standings(db, season, now).await?;
    let skill_mix = skill_mix(&skills, &all);
    let ranked = rank_and_filter(all, skill_label.as_deref());
    let entries: Vec<Value> = page_of(&ranked, page, page_size)
        .map(|(rank, entry)| entry_json(entry, *rank, &viewer.id, &tiers))
        .collect();
    Ok(json!({
        "season": season.map(|season| season_json(season, now)),
        "view": view,
        "entries": entries,
        "page": page,
        "pageSize": page_size,
        "total": ranked.len(),
        "skills": skills.iter().map(skill_json).collect::<Vec<_>>(),
        "seasons": all_seasons.iter().map(|season| season_summary_json(season, now)).collect::<Vec<_>>(),
        "skillMix": skill_mix,
        "meta": {"mode": "live", "label": "Live leaderboard"},
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
        .enumerate()
        .map(|(index, entry)| (index + 1, entry))
        .filter(|(_, entry)| {
            skill_label.is_none_or(|label| entry.skills.iter().any(|skill| skill == label))
        })
        .collect()
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
