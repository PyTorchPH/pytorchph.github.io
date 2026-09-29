//! Season leaderboard and member overview computed from the point ledger, pending
//! evidence, rank tiers and verified skills. Members with an active integrity
//! sanction are excluded from ranking until an officer restores them.
//!
//! Module map:
//!   board      member_leaderboard: one page of the season board with its filters
//!   overview   overlay_overview: the signed-in member's standing and activity
//!   profile    member_profile: a ranked member's achievements, when visible
//!   standings  every eligible member ranked for a season (shared by the three above)
//!   seasons    season selection and ISO-week arithmetic
//!   tiers      rank tiers and III / II / I divisions
//!   params     query-string parameters
mod board;
mod overview;
mod params;
mod profile;
mod seasons;
mod standings;
mod tiers;

pub(crate) use board::member_leaderboard;
pub(crate) use overview::overlay_overview;
pub(crate) use profile::member_profile;
