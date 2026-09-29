//! Career evidence: member submissions, officer review, sanctions and appeals.
//!
//! Module map:
//!   submission      member-facing routes: manual claims, extension envelopes, claim lists
//!   manual_queue    a member's approved portfolio item entering the officer queue
//!   review          officer review with the published rubric (approve, reject, confirm)
//!   rubric          verified levels and their weighted points
//!   sanctions       leaderboard sanctions and a member's integrity cases
//!   appeals         member appeals against sanctions and officer decisions on them
//!   claim_view      the officer review queue in the portal's EvidenceClaim shape
//!   claim_labels    anonymous member labels and the department that owns a claim
//!   request_fields  trimmed text fields and reason length rules shared by requests
//!   integrity       the historical path the portal gateway and other modules import
pub(crate) mod appeals;
pub(crate) mod claim_labels;
pub(crate) mod claim_view;
pub(crate) mod integrity;
pub(crate) mod manual_queue;
pub(crate) mod request_fields;
pub(crate) mod review;
pub(crate) mod rubric;
pub(crate) mod sanctions;
pub(crate) mod submission;
