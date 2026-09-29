//! Officer evidence review with the published point rubric, leaderboard integrity
//! sanctions, and member appeals. Response shapes match the portal UI contracts
//! (`EvidenceClaim`, `EvidenceIntegrityCase`, `OfficerEvidenceAppeal`).
//!
//! This module is the stable import path; each concept lives in its own sibling module:
//!   member_label, department   → claim_labels
//!   rubric_points              → rubric
//!   officer_claims             → claim_view
//!   review_claim               → review
//!   member_integrity           → sanctions
//!   open_appeal, officer_appeals, resolve_appeal → appeals
//!   queue_manual_claim         → manual_queue
#[allow(unused_imports)] // kept reachable at their historical paths
pub(crate) use super::{
    appeals::{officer_appeals, open_appeal, resolve_appeal},
    claim_labels::{department, member_label},
    claim_view::officer_claims,
    manual_queue::queue_manual_claim,
    review::review_claim,
    rubric::rubric_points,
    sanctions::member_integrity,
};
