//! Member-typed text → ranked schools.
//!
//! Every word is its own keyword: "college lucena sti" finds "STI College - Lucena" because each
//! word must prefix-match some word in the name, acronym, city, or province (in any order).
//! Matching is case- and accent-insensitive (FTS5 unicode61 with remove_diacritics).
//!
//! Module map (caller-first):
//!   search_schools     keywords → FTS5 MATCH → rows ranked by bm25 (name and acronym weigh most)
//!   └─ fts_query       text → `"sti"* AND "college"* AND "lucena"*`
//!       └─ keywords    lowercase alphanumeric words, capped in count and length
use super::School;
use crate::{ApiResult, internal};
use sqlx::SqlitePool;

const MAX_KEYWORDS: usize = 8;
const MAX_KEYWORD_LENGTH: usize = 40;

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

/// Each keyword becomes a quoted prefix term, so no member input is read as FTS5 syntax.
pub(crate) fn fts_query(text: &str) -> Option<String> {
    let terms: Vec<String> = keywords(text)
        .iter()
        .map(|word| format!("\"{word}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" AND "))
}

pub(crate) fn keywords(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(|word| word.chars().take(MAX_KEYWORD_LENGTH).collect())
        .take(MAX_KEYWORDS)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::fts_query;

    #[test]
    fn every_word_becomes_a_quoted_prefix_keyword() {
        assert_eq!(
            fts_query("College  LUCENA sti").unwrap(),
            r#""college"* AND "lucena"* AND "sti"*"#
        );
    }

    #[test]
    fn punctuation_and_fts_syntax_are_treated_as_separators() {
        assert_eq!(
            fts_query("STI-Calamba \"OR\" (x)*").unwrap(),
            r#""sti"* AND "calamba"* AND "or"* AND "x"*"#
        );
        assert_eq!(fts_query(" - * "), None);
    }
}
