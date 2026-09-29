//! Shared plumbing for the bundled reference directories (schools, companies).
//!
//! Module map:
//!   seed      versioned, gzipped TSV seeds: is it already loaded? decompress, record the version
//!   keywords  member-typed text → FTS5 prefix query (every word is its own keyword, any order)
//!   matching  after FTS5: every keyword claims its own word (bipartite); rank by name coverage
pub(crate) mod keywords;
pub(crate) mod matching;
pub(crate) mod seed;

pub(crate) use keywords::fts_query;

/// How many FTS5 candidates the matching step sees; enough that a truncated prefilter never hides
/// a record the member typed in full.
pub(crate) const CANDIDATE_POOL: i64 = 400;
pub(crate) use matching::{Searchable, rank_matches};
