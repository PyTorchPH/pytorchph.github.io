//! Member-facing evidence routes (`/evidence*`).
//!
//! Module map:
//!   manual_claim      POST /evidence              a member's typed-in claim with its own hash
//!   extension         POST /evidence/extension    items collected by the browser extension
//!   claim_list        GET  /evidence/me, /evidence/pending
//!   direct_review     POST /evidence/{id}/review  officer approve/reject with explicit points
//!   member_gate       signed-in, approved members only
pub(crate) mod claim_list;
pub(crate) mod direct_review;
pub(crate) mod extension;
pub(crate) mod manual_claim;
pub(crate) mod member_gate;

pub(crate) use claim_list::{my_claims, pending_claims};
pub(crate) use direct_review::review_claim;
pub(crate) use extension::submit_extension;
pub(crate) use manual_claim::submit_claim;
