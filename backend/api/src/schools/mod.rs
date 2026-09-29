//! The Philippine school directory: basic education (DepEd), higher education (CHED), and
//! technical-vocational schools, searchable by any mix of name words, acronym, and city.
//!
//! Module map:
//!   load     startup: loads the compressed seed into SQLite when its version changes
//!   search   member-typed text → FTS5 prefix query → ranked schools
//!   lookup   one school by code (validation and display labels)
//!   display  the label and detail line members see (name with campus, acronym · city · level)
pub(crate) mod display;
pub(crate) mod load;
pub(crate) mod lookup;
pub(crate) mod search;

pub(crate) use load::load_school_directory;
pub(crate) use lookup::find_school;
pub(crate) use search::search_schools;

/// One directory row, as stored in `schools`.
#[derive(Clone, Debug, sqlx::FromRow)]
pub(crate) struct School {
    pub(crate) code: String,
    pub(crate) name: String,
    pub(crate) acronym: String,
    pub(crate) level: String,
    pub(crate) sector: String,
    pub(crate) city: String,
    pub(crate) province: String,
}
