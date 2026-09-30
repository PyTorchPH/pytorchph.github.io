//! Collaborative event emails with role-based human review.
//!
//! The creator (with their own AI in the extension, or by hand) splits an email into sections
//! owned by positions and tags key phrases for the positions responsible for them. Each owner
//! sees only their parts: confirming unchanged text is a cache hit; their own edit is approved at
//! once; an edit by anyone else is a cache miss that sends the part back to its owner. When every
//! part is confirmed and every question answered, the email goes to the Secretary General, then
//! the President, then the Communications Officer (or the CMO), who sends it into mail delivery.
//!
//! Module map:
//!   model    input parsing, content hashing, the assembled email and its hash
//!   access   which positions a member holds and what they may see or do
//!   create   a new draft from the creator's split (AI-suggested or manual)
//!   review   owners confirm or edit sections and tags, and answer questions
//!   chain    readiness, Secretariat → President approvals, and the send hand-off
//!   view     the list of drafts a member is part of, and each member's scoped view
//!   audit    who changed what (hashes, not content)
pub(crate) mod access;
pub(crate) mod audit;
pub(crate) mod chain;
pub(crate) mod create;
pub(crate) mod model;
pub(crate) mod review;
pub(crate) mod view;

/// Chain positions, in order; the sender falls back to the CMO when no Communications Officer exists.
pub(crate) const SECRETARIAT: &str = "secretary_general";
pub(crate) const PRESIDENT: &str = "president";
pub(crate) const SENDER: &str = "communications_officer";
pub(crate) const SENDER_FALLBACK: &str = "cmo";
