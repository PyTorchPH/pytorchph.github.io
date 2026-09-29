//! Public lookups for the profile form: answer options, school search, company search.
//!
//! Module map (caller-first):
//!   profile_options   GET /reference/profile-options
//!   schools           GET /reference/schools?q=&limit=
//!   companies         GET /reference/companies?q=&limit=
//!   └─ search_limit   bounded result size
use super::catalog;
use crate::{ApiResult, AppState, internal};
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

pub(crate) async fn schools(Query(search): Query<Search>) -> Json<Value> {
    let rows: Vec<Value> = catalog::search_schools(&search.q, search_limit(search.limit))
        .into_iter()
        .map(|school| json!({"code": school.code, "label": school.name, "type": school.kind, "region": school.region}))
        .collect();
    Json(Value::Array(rows))
}

pub(crate) async fn companies(
    State(state): State<Arc<AppState>>,
    Query(search): Query<Search>,
) -> ApiResult<Json<Value>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, name FROM companies WHERE name LIKE '%' || ? || '%' COLLATE NOCASE ORDER BY instr(lower(name), lower(?)) , name LIMIT ?",
    )
    .bind(search.q.trim())
    .bind(search.q.trim())
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
