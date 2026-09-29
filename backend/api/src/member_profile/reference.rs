//! Public lookups for the profile form: answer options, school, program, and company search.
//! Every search treats each typed word as its own prefix keyword, in any order.
//!
//! Module map (caller-first):
//!   profile_options   GET /reference/profile-options
//!   schools           GET /reference/schools?q=&limit=            (crate::schools)
//!   programs          GET /reference/programs?level=&q=&limit=    (crate::programs; short
//!                     levels return their whole list when q is empty)
//!   companies         GET /reference/companies?q=&limit=          (crate::companies)
//!   └─ search_limit   bounded result size
use super::catalog;
use crate::{
    ApiResult, AppState, bad,
    companies::{
        display::{company_detail, is_verified},
        search_companies,
    },
    programs::programs_for_level,
    schools::{
        display::{school_detail, school_label},
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

#[derive(Deserialize)]
pub(crate) struct ProgramSearch {
    level: String,
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

pub(crate) async fn programs(
    State(state): State<Arc<AppState>>,
    Query(search): Query<ProgramSearch>,
) -> ApiResult<Json<Value>> {
    if !catalog::has_option("schoolLevels", &search.level) {
        return Err(bad("Choose a school level"));
    }
    let rows = programs_for_level(
        &state.db,
        &search.level,
        &search.q,
        search_limit(search.limit),
    )
    .await?;
    Ok(Json(Value::Array(
        rows.iter()
            .map(|program| {
                json!({
                    "code": program.code,
                    "label": program.name,
                    "shortName": program.short_name,
                    "group": program.group_name,
                })
            })
            .collect(),
    )))
}

pub(crate) async fn companies(
    State(state): State<Arc<AppState>>,
    Query(search): Query<Search>,
) -> ApiResult<Json<Value>> {
    let rows = search_companies(&state.db, &search.q, search_limit(search.limit)).await?;
    Ok(Json(Value::Array(
        rows.iter()
            .map(|company| {
                json!({
                    "id": company.id,
                    "label": company.name,
                    "detail": company_detail(company),
                    "aliases": company.aliases,
                    "city": company.city,
                    "verified": is_verified(company),
                })
            })
            .collect(),
    )))
}

#[inline]
fn search_limit(requested: Option<usize>) -> usize {
    requested.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}
