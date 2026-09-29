//! Member-typed text → ranked companies: every word is its own prefix keyword across name,
//! aliases (acronyms, trade names, tickers), and city; verified companies rank before
//! member-added ones.
use super::Company;
use crate::{
    ApiResult, internal,
    reference_data::{CANDIDATE_POOL, Searchable, fts_query, rank_matches},
};
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
    let candidates: Vec<Company> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT c.id, c.name, c.aliases, c.city, c.industry, c.origin \
         FROM company_search JOIN companies c ON c.rowid = company_search.rowid \
         WHERE company_search MATCH ? ORDER BY c.origin = 'member', {RANKING}, c.name LIMIT ?"
    )))
    .bind(query)
    .bind(CANDIDATE_POOL)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    let mut ranked = rank_matches(candidates, text, CANDIDATE_POOL as usize, |company| {
        Searchable {
            name: &company.name,
            other_fields: vec![&company.aliases, &company.city],
        }
    });
    // Verified companies stay ahead of member-added ones; coverage order holds within each.
    ranked.sort_by_key(|company| company.origin == "member");
    ranked.truncate(limit);
    Ok(ranked)
}
