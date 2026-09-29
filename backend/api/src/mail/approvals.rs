//! Routed approvals: each required role approves one exact revision.
//!
//! Module map (caller-first):
//!   approve_draft         POST /mail/drafts/{id}/approve
//!   └─ may_approve        editable draft, a required role, and the approver holds it
use super::content::is_editable_status;
use super::drafts::stale_revision;
use super::revisions::load_current_draft;
use super::roles::has_role;
use crate::{ApiError, ApiResult, AppState, check_origin, identity::session, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApproveInput {
    revision: i64,
    role: String,
}

/// Mental model: an approval names the revision it read and the role it approves as; approving
/// again for the same role replaces the approver.
pub async fn approve_draft(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<ApproveInput>,
) -> ApiResult<StatusCode> {
    check_origin(&state, &headers)?;
    let actor = session::require_officer(&state, &headers).await?;
    let draft = load_current_draft(&state, &id).await?;
    if draft.revision != input.revision {
        return Err(stale_revision());
    }
    let may_approve = is_editable_status(&draft.status)
        && draft.content.required_roles.contains(&input.role)
        && has_role(&state, &actor.id, &input.role).await?;
    if !may_approve {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Approval role not permitted",
        ));
    }
    sqlx::query("INSERT INTO mail_approvals(draft_id,revision,role,approver_id,created_at) VALUES (?,?,?,?,?) ON CONFLICT(draft_id,revision,role) DO UPDATE SET approver_id=excluded.approver_id,created_at=excluded.created_at")
        .bind(&id).bind(draft.revision).bind(&input.role).bind(&actor.id).bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db).await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}
