//! The organization chart: departments, positions and who holds them, and delegation down it.
//!
//! Module map:
//!   reservations   positions reserved for an email, claimed at that member's first sign-in
//!   tree           the delegation rule: a position is managed by the holder of its parent
//!   assignments    assign / remove / resign, each authorized, role-synced, and logged
//!   role_sync      account role and mail approval roles follow the positions held
//!   chart          the Organization page view and member search for assigning
pub(crate) mod assignments;
pub(crate) mod chart;
pub(crate) mod reservations;
pub(crate) mod role_sync;
pub(crate) mod tree;

pub(crate) use reservations::claim_reserved_positions;
