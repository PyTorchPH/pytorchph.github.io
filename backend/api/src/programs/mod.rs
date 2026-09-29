//! The program and strand catalog: junior high special programs, senior high strands and
//! clusters, college and graduate degrees (PSA PSCED), and TESDA qualifications.
//!
//! Module map:
//!   load     startup: loads the compressed seed into SQLite when its version changes
//!   search   one level's programs: the whole list (short lists) or keyword search (long lists)
//!   lookup   whether a program code belongs to a school level
pub(crate) mod load;
pub(crate) mod lookup;
pub(crate) mod search;

pub(crate) use load::load_program_catalog;
pub(crate) use lookup::program_fits_level;
pub(crate) use search::programs_for_level;

pub(crate) const UNLISTED_PROGRAM: &str = "unlisted";

#[derive(Clone, Debug, sqlx::FromRow)]
pub(crate) struct Program {
    pub(crate) code: String,
    pub(crate) name: String,
    pub(crate) short_name: String,
    pub(crate) group_name: String,
}
