//! How many members show each normalized skill, under the newest published skill list.
//!
//! Module map (caller-first):
//!   skill_tally       latest version → map every member's raw words → count members per skill
//!   ├─ latest_version  the newest skill_taxonomy_versions row, if any
//!   └─ alias_map       raw word → (skill, category) for that version
use super::raw_skills::member_raw_skills;
use crate::{ApiResult, internal};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use std::collections::{BTreeSet, HashMap};

// Mental model: each member counts once per normalized skill, however many raw words or
// achievements point at it; raw words the list does not cover are counted as unmapped.
pub(crate) async fn skill_tally(db: &SqlitePool) -> ApiResult<Value> {
    let Some((version, published_by, published_at)) = latest_version(db).await? else {
        return Ok(
            json!({"version": null, "skills": [], "membersWithSkills": 0, "unmappedRaw": 0}),
        );
    };
    let aliases = alias_map(db, &version).await?;
    let members = member_raw_skills(db).await?;
    let mut counts: HashMap<&str, usize> = HashMap::new();
    let mut unmapped: BTreeSet<&str> = BTreeSet::new();
    for raw_words in members.values() {
        let mut skills: BTreeSet<&str> = BTreeSet::new();
        for raw in raw_words {
            match aliases.get(raw) {
                Some((skill, _)) => {
                    skills.insert(skill.as_str());
                }
                None => {
                    unmapped.insert(raw.as_str());
                }
            }
        }
        for skill in skills {
            *counts.entry(skill).or_default() += 1;
        }
    }
    let categories: HashMap<&str, &str> = aliases
        .values()
        .map(|(skill, category)| (skill.as_str(), category.as_str()))
        .collect();
    let mut ranked: Vec<(&str, usize)> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    let total = members.len();
    Ok(json!({
        "version": {"publishedBy": published_by, "publishedAt": published_at},
        "skills": ranked.iter().map(|(skill, members)| json!({
            "skill": skill, "category": categories.get(skill).copied().unwrap_or("Other"),
            "members": members, "share": (members * 100).checked_div(total).unwrap_or(0),
        })).collect::<Vec<_>>(),
        "membersWithSkills": total,
        "unmappedRaw": unmapped.len(),
    }))
}

async fn latest_version(db: &SqlitePool) -> ApiResult<Option<(String, String, String)>> {
    sqlx::query_as("SELECT id, published_by_name, published_at FROM skill_taxonomy_versions ORDER BY published_at DESC LIMIT 1")
        .fetch_optional(db)
        .await
        .map_err(internal)
}

async fn alias_map(db: &SqlitePool, version: &str) -> ApiResult<HashMap<String, (String, String)>> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT a.raw, a.skill_name, s.category FROM skill_taxonomy_aliases a \
         JOIN skill_taxonomy_skills s ON s.version_id = a.version_id AND s.name = a.skill_name WHERE a.version_id = ?",
    )
    .bind(version)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    Ok(rows
        .into_iter()
        .map(|(raw, skill, category)| (raw, (skill, category)))
        .collect())
}
