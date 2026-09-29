//! The rendered PDF attachment of a draft, always checked against its stored hash.
//!
//! Module map (caller-first):
//!   preview_pdf    GET /mail/drafts/{id}/pdf (officers with draft access)
//!   dispatch_pdf   GET /internal/mail/{id}/pdf (workflow key, claimed dispatch only)
//!   pdf_response   inline PDF, never cached, never sniffed
use super::dispatch::check_workflow_key;
use super::drafts::require_draft_access;
use super::revisions::{load_current_draft, pdf_matches_hash, revision_pdf};
use crate::{ApiError, ApiResult, AppState, identity::session, internal};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use std::sync::Arc;

pub async fn preview_pdf(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let actor = session::require_officer(&state, &headers).await?;
    let draft = load_current_draft(&state, &id).await?;
    require_draft_access(&state, &actor, &id, &draft.content).await?;
    let Some((Some(bytes), Some(hash))) = revision_pdf(&state, &id, draft.revision).await? else {
        return Err(ApiError(StatusCode::NOT_FOUND, "PDF not available"));
    };
    if !pdf_matches_hash(&bytes, &hash) {
        return Err(integrity_failed());
    }
    Ok(pdf_response(bytes))
}

/// Mental model: the workflow may only fetch the PDF of the revision it claimed, identified by
/// the content hash pinned at release.
pub async fn dispatch_pdf(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    check_workflow_key(&state, &headers)?;
    let row: Option<(Option<Vec<u8>>, Option<String>)> = sqlx::query_as("SELECT r.pdf_bytes,r.pdf_sha256 FROM mail_dispatch d JOIN mail_revisions r ON r.draft_id=d.draft_id AND r.revision=d.revision AND r.content_hash=d.content_hash WHERE d.draft_id=? AND d.status='claimed'")
        .bind(&id).fetch_optional(&state.db).await.map_err(internal)?;
    let Some((Some(bytes), Some(hash))) = row else {
        return Err(ApiError(StatusCode::NOT_FOUND, "Claimed PDF not found"));
    };
    if !pdf_matches_hash(&bytes, &hash) {
        return Err(integrity_failed());
    }
    Ok(pdf_response(bytes))
}

fn pdf_response(bytes: Vec<u8>) -> Response {
    (
        [
            ("content-type", "application/pdf"),
            (
                "content-disposition",
                "inline; filename=approved-attachment.pdf",
            ),
            ("cache-control", "no-store"),
            ("x-content-type-options", "nosniff"),
        ],
        bytes,
    )
        .into_response()
}

#[inline]
fn integrity_failed() -> ApiError {
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "PDF integrity check failed",
    )
}
