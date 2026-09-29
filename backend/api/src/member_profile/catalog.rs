//! Reference catalogs compiled into the binary: the profile answer options and the CHED list of
//! higher education institutions. Database rows store only their codes.
//!
//! Module map (caller-first):
//!   options / has_option / option_label   the answer lists (gender, region, interest, …)
//!   schools / school / search_schools     the CHED HEI masterlist
//!   └─ matches_query                       case-insensitive name match
use serde_json::Value;
use std::sync::OnceLock;

pub(crate) const UNLISTED_SCHOOL: &str = "unlisted";

pub(crate) struct School {
    pub(crate) code: String,
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) region: String,
}

static OPTIONS: OnceLock<Value> = OnceLock::new();
static SCHOOLS: OnceLock<Vec<School>> = OnceLock::new();

pub(crate) fn options() -> &'static Value {
    OPTIONS.get_or_init(|| {
        serde_json::from_str(include_str!("../../seeds/reference/profile-options.json"))
            .expect("profile options catalog is valid JSON")
    })
}

/// True when `code` is one of the choices in the named list (e.g. "regions").
pub(crate) fn has_option(list: &str, code: &str) -> bool {
    option_label(list, code).is_some()
}

pub(crate) fn option_label(list: &str, code: &str) -> Option<&'static str> {
    options()
        .get(list)?
        .as_array()?
        .iter()
        .find(|item| item.get("code").and_then(Value::as_str) == Some(code))
        .and_then(|item| item.get("label"))
        .and_then(Value::as_str)
}

pub(crate) fn schools() -> &'static [School] {
    SCHOOLS.get_or_init(|| {
        let catalog: Value =
            serde_json::from_str(include_str!("../../seeds/reference/schools.json"))
                .expect("schools catalog is valid JSON");
        catalog["rows"]
            .as_array()
            .map(|rows| rows.iter().filter_map(school_from_row).collect())
            .unwrap_or_default()
    })
}

fn school_from_row(row: &Value) -> Option<School> {
    let text = |index: usize| row.get(index).and_then(Value::as_str).map(str::to_owned);
    Some(School {
        code: text(0)?,
        name: text(1)?,
        kind: text(2)?,
        region: text(3)?,
    })
}

pub(crate) fn school(code: &str) -> Option<&'static School> {
    schools().iter().find(|school| school.code == code)
}

/// Names starting with the query come first, then names containing it.
pub(crate) fn search_schools(query: &str, limit: usize) -> Vec<&'static School> {
    let query = query.trim().to_lowercase();
    let (mut starts, mut contains): (Vec<_>, Vec<_>) = schools()
        .iter()
        .filter(|school| matches_query(&school.name, &query))
        .partition(|school| school.name.to_lowercase().starts_with(&query));
    starts.append(&mut contains);
    starts.truncate(limit);
    starts
}

#[inline]
fn matches_query(name: &str, query: &str) -> bool {
    query.is_empty() || name.to_lowercase().contains(query)
}
