//! Actions on the member's product views (the JSON documents behind Career Evidence,
//! Resumes & Opportunities and the dashboard).
//!
//! Module map:
//!   demo_actions    advance an opportunity · toggle an event · approve a review
//!   opportunities   manually tracked job opportunities
//!   evidence        manual career evidence items (approved ones go to officer review)
//!   photo           evidence photos stored as owner-only media
//!   remove_evidence a member deletes their own achievement; its claim and points go with it
//!   sources         connect, sync or disconnect an evidence source
//!   analysis        the static, consent-gated evidence review
pub(crate) mod analysis;
pub(crate) mod demo_actions;
pub(crate) mod evidence;
pub(crate) mod opportunities;
pub(crate) mod photo;
pub(crate) mod remove_evidence;
pub(crate) mod sources;
