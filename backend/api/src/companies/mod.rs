//! The company directory: verified Philippine companies (Wikidata, GLEIF, PSE, curated) plus the
//! companies members add, which stay searchable but unverified.
//!
//! Module map:
//!   load     startup: merges the bundled seed into `companies` when its version changes
//!   search   member-typed text → FTS5 prefix query → ranked companies (verified first)
//!   display  the detail line members see (aliases · city · industry) and the verified flag
pub(crate) mod display;
pub(crate) mod load;
pub(crate) mod search;

pub(crate) use load::load_company_directory;
pub(crate) use search::search_companies;

#[derive(Clone, Debug, sqlx::FromRow)]
pub(crate) struct Company {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) aliases: String,
    pub(crate) city: String,
    pub(crate) industry: String,
    pub(crate) origin: String,
}
