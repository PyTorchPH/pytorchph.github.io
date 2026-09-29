//! Shared plumbing for the bundled reference directories (schools, companies).
//!
//! Module map:
//!   seed      versioned, gzipped TSV seeds: is it already loaded? decompress, record the version
//!   keywords  member-typed text → FTS5 prefix query (every word is its own keyword, any order)
pub(crate) mod keywords;
pub(crate) mod seed;

pub(crate) use keywords::fts_query;
