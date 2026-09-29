//! Member profile details for community demographics.
//!
//! Module map:
//!   catalog        the JSON reference lists (options, CHED schools) the stored codes point into
//!   reference      public GET /reference/* lookups for the profile form
//!   input          parses and validates a submitted profile into typed choices
//!   store          saves and reads a profile across its normalized tables
//!   demographics   aggregated, consent-only breakdowns for officers
pub(crate) mod catalog;
pub(crate) mod demographics;
pub(crate) mod input;
pub(crate) mod reference;
pub(crate) mod store;

pub(crate) use demographics::demographics;
pub(crate) use store::{read_profile, save_profile};
