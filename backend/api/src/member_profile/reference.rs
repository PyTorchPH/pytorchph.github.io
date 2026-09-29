//! Public lookups for the profile form: answer options, school search, company search.
//! Both searches treat every typed word as its own keyword, in any order.
//!
//! Module map (caller-first):
//!   profile_options   GET /reference/profile-options
//!   schools           GET /reference/schools?q=&limit=     (FTS5 directory, crate::schools)
//!   companies         GET /reference/companies?q=&limit=   (every word must appear in the name)
//!   └─ search_limit   bounded result size
use super::catalog;
use crate::{
    ApiResult, AppState, internal,
    schools::{
        display::{school_detail, school_label},
        search::keywords,
        search_schools,
    },
};
use axum::{
    Json,
    extract::{Query, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

const DEFAULT_LIMIT: usize = 20;
const MAX_LIMIT: usize = 50;

#[derive(Deserialize)]
pub(crate) struct Search {
    #[serde(default)]
    q: String,
    limit: Option<usize>,
}

pub(crate) async fn profile_options() -> Json<Value> {
    Json(catalog::options().clone())
}

pub(crate) async fn schools(
    State(state): State<Arc<AppState>>,
    Query(search): Query<Search>,
) -> ApiResult<Json<Value>> {
    let rows = search_schools(&state.db, &search.q, search_limit(search.limit)).await?;
    Ok(Json(Value::Array(
        rows.iter()
            .map(|school| {
                json!({
                    "code": school.code,
                    "label": school_label(school),
                    "detail": school_detail(school),
                    "acronym": school.acronym,
                    "level": school.level,
                    "sector": school.sector,
                    "city": school.city,
                    "province": school.province,
                })
            })
            .collect(),
    )))
}

// Companies stay a small SQL table, so each keyword is one LIKE; names matching the first word
// earlier rank first. With no keywords every company matches.
pub(crate) async fn companies(
    State(state): State<Arc<AppState>>,
    Query(search): Query<Search>,
) -> ApiResult<Json<Value>> {
    let words = keywords(&search.q);
    let filters = if words.is_empty() {
        "1 = 1".to_owned()
    } else {
        vec!["lower(name) LIKE '%' || ? || '%'"; words.len()].join(" AND ")
    };
    let mut query = sqlx::query_as::<_, (String, String)>(sqlx::AssertSqlSafe(format!(
        "SELECT id, name FROM companies WHERE {filters} ORDER BY instr(lower(name), ?), name LIMIT ?"
    )));
    for word in &words {
        query = query.bind(word.clone());
    }
    let rows = query
        .bind(words.first().cloned().unwrap_or_default())
        .bind(search_limit(search.limit) as i64)
        .fetch_all(&state.db)
        .await
        .map_err(internal)?;
    Ok(Json(Value::Array(
        rows.into_iter()
            .map(|(id, name)| json!({"id": id, "label": name}))
            .collect(),
    )))
}

#[inline]
fn search_limit(requested: Option<usize>) -> usize {
    requested.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}
