//! Member-typed text → ranked schools (every word is its own prefix keyword, any order, across
//! name, acronym, city, and province; see reference_data::keywords).
use super::School;
use crate::{ApiResult, internal, reference_data::fts_query};
use sqlx::SqlitePool;

// Column weights for bm25, in index order: name, acronym, city, province.
const RANKING: &str = "bm25(school_search, 10.0, 12.0, 4.0, 1.0)";

pub(crate) async fn search_schools(
    db: &SqlitePool,
    text: &str,
    limit: usize,
) -> ApiResult<Vec<School>> {
    let Some(query) = fts_query(text) else {
        return Ok(Vec::new());
    };
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT s.code, s.name, s.acronym, s.level, s.sector, s.city, s.province \
         FROM school_search JOIN schools s ON s.rowid = school_search.rowid \
         WHERE school_search MATCH ? ORDER BY {RANKING}, s.name LIMIT ?"
    )))
    .bind(query)
    .bind(limit as i64)
    .fetch_all(db)
    .await
    .map_err(internal)
}
