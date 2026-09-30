//! Approval-routed organization mail: officers draft, the routed roles approve, the sender
//! releases, and an external workflow delivers the exact approved revision.
//!
//! Module map (lifecycle order):
//!   roles       officer role vocabulary and who holds which role
//!   routes      admin setup: officer roles per member, approval route per category
//!   content     what a revision contains, its validation and its content hash
//!   revisions   storing revisions and reading a draft's current revision
//!   drafts      create, read and edit drafts (optimistic If-Match revisions)
//!   approvals   routed roles approve one exact revision
//!   release     the sender role releases a fully approved revision for delivery
//!   dispatch    the delivery workflow claims jobs and reports receipts; admins reconcile
//!   assembled   collaborative emails enter delivery already approved (crate::collab_mail)
//!   attachment  the rendered PDF attachment, checked against its stored hash
//!   pdf         text → PDF rendering
mod approvals;
mod assembled;
mod attachment;
mod content;
mod dispatch;
mod drafts;
pub(crate) mod pdf;
mod release;
mod revisions;
mod roles;
mod routes;

pub(crate) use approvals::approve_draft;
pub(crate) use assembled::queue_assembled_mail;
pub(crate) use attachment::{dispatch_pdf, preview_pdf};
pub(crate) use dispatch::{claim_dispatch, reconcile_dispatch, record_receipt};
pub(crate) use drafts::{create_draft, edit_draft, read_draft};
pub(crate) use release::release_draft;
pub(crate) use routes::{set_officer_roles, set_route};
