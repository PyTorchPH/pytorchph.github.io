//! Raw skill words from every member's verified achievements, with how many members use each.
//! Only words and counts leave the server; no member is identified.
//!
//! Module map (caller-first):
//!   raw_skill_counts   distinct lowercased words → member count, most common first
//!   member_raw_skills  one member → their raw skill words (shared with the tally)
//!   └─ verified_skills   skills of items a source or the member confirmed
use crate::{ApiResult, internal};
use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::{BTreeSet, HashMap};

pub(crate) const CAREER_EVIDENCE_KEY: &str = "/api/product/career-evidence";
const MAX_RAW_LENGTH: usize = 80;

pub(crate) async fn raw_skill_counts(db: &SqlitePool) -> ApiResult<Vec<(String, usize)>> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for skills in member_raw_skills(db).await?.into_values() {
        for skill in skills {
            *counts.entry(skill).or_default() += 1;
        }
    }
    let mut ranked: Vec<(String, usize)> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    Ok(ranked)
}

/// member id → the distinct raw skill words on their verified achievements.
pub(crate) async fn member_raw_skills(
    db: &SqlitePool,
) -> ApiResult<HashMap<String, BTreeSet<String>>> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT scope, value_json FROM portal_state WHERE state_key = ?")
            .bind(CAREER_EVIDENCE_KEY)
            .fetch_all(db)
            .await
            .map_err(internal)?;
    Ok(rows
        .into_iter()
        .filter_map(|(member, json)| {
            serde_json::from_str::<Value>(&json)
                .ok()
                .map(|view| (member, verified_skills(&view)))
        })
        .filter(|(_, skills)| !skills.is_empty())
        .collect())
}

fn verified_skills(view: &Value) -> BTreeSet<String> {
    view.pointer("/evidence/items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| {
            matches!(
                item["verificationState"].as_str(),
                Some("user_verified" | "source_matched")
            )
        })
        .flat_map(|item| item["skills"].as_array().cloned().unwrap_or_default())
        .filter_map(|skill| skill.as_str().map(normalize_raw))
        .filter(|skill| !skill.is_empty() && skill.chars().count() <= MAX_RAW_LENGTH)
        .collect()
}

/// Lowercase, trimmed, single-spaced: the key raw words are compared by.
pub(crate) fn normalize_raw(word: &str) -> String {
    word.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
