//! Member-typed text → ranked companies: every word is its own prefix keyword across name,
//! aliases (acronyms, trade names, tickers), and city; verified companies rank before
//! member-added ones.
use super::Company;
use crate::{ApiResult, internal, reference_data::fts_query};
use sqlx::SqlitePool;

// Column weights for bm25, in index order: name, aliases, city.
const RANKING: &str = "bm25(company_search, 10.0, 8.0, 2.0)";

pub(crate) async fn search_companies(
    db: &SqlitePool,
    text: &str,
    limit: usize,
) -> ApiResult<Vec<Company>> {
    let Some(query) = fts_query(text) else {
        return Ok(Vec::new());
    };
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT c.id, c.name, c.aliases, c.city, c.industry, c.origin \
         FROM company_search JOIN companies c ON c.rowid = company_search.rowid \
         WHERE company_search MATCH ? ORDER BY c.origin = 'member', {RANKING}, c.name LIMIT ?"
    )))
    .bind(query)
    .bind(limit as i64)
    .fetch_all(db)
    .await
    .map_err(internal)
}
