//! One level's programs. Short lists (junior and senior high) come back whole for a dropdown;
//! long lists (college, graduate, tech-voc) need typed keywords, each a prefix of some word in the
//! name, acronym (BSCS), or field group, in any order.
//!
//! Module map (caller-first):
//!   programs_for_level   empty text → the whole level (short lists only); else keyword search
//!   ├─ whole_level       ordered by group, then name
//!   └─ matching          FTS5 prefix candidates, then each keyword claims its own word
//!                        (reference_data::matching); fullest name coverage first
use super::Program;
use crate::{
    ApiResult, internal,
    reference_data::{CANDIDATE_POOL, Searchable, fts_query, rank_matches},
};
use sqlx::SqlitePool;

/// Levels whose whole list fits in a dropdown.
const LISTED_WHOLE: [&str; 2] = ["junior_high", "senior_high"];
const WHOLE_LIST_CAP: i64 = 200;
const RANKING: &str = "bm25(program_search, 10.0, 12.0, 1.0)";

pub(crate) async fn programs_for_level(
    db: &SqlitePool,
    level: &str,
    text: &str,
    limit: usize,
) -> ApiResult<Vec<Program>> {
    match fts_query(text) {
        Some(query) => matching(db, level, &query, text, limit).await,
        None if LISTED_WHOLE.contains(&level) => whole_level(db, level).await,
        None => Ok(Vec::new()),
    }
}

async fn whole_level(db: &SqlitePool, level: &str) -> ApiResult<Vec<Program>> {
    sqlx::query_as("SELECT code, name, short_name, group_name FROM programs WHERE level = ? ORDER BY group_name, rowid LIMIT ?")
        .bind(level)
        .bind(WHOLE_LIST_CAP)
        .fetch_all(db)
        .await
        .map_err(internal)
}

async fn matching(
    db: &SqlitePool,
    level: &str,
    query: &str,
    text: &str,
    limit: usize,
) -> ApiResult<Vec<Program>> {
    let candidates: Vec<Program> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT p.code, p.name, p.short_name, p.group_name \
         FROM program_search JOIN programs p ON p.rowid = program_search.rowid \
         WHERE program_search MATCH ? AND p.level = ? ORDER BY {RANKING}, p.name LIMIT ?"
    )))
    .bind(query)
    .bind(level)
    .bind(CANDIDATE_POOL)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    Ok(rank_matches(candidates, text, limit, |program| {
        Searchable {
            name: &program.name,
            other_fields: vec![&program.short_name, &program.group_name],
        }
    }))
}
