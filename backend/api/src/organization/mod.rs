//! The organization chart: departments, positions and who holds them.
//!
//! Module map:
//!   reservations   positions reserved for an email, claimed at that member's first sign-in
pub(crate) mod reservations;

pub(crate) use reservations::claim_reserved_positions;
