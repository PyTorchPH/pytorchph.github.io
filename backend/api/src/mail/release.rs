//! Releasing a fully approved revision so the delivery workflow can send it.
//!
//! Module map (caller-first):
//!   release_draft                 POST /mail/drafts/{id}/release
//!   ├─ ensure_pdf_intact          an attached PDF must exist and match its hash
//!   ├─ ensure_approvals_complete  every required role approved, by someone still holding it
//!   └─ queue_dispatch             marks it released and queues the exact content hash
use super::content::{Content, content_hash, is_editable_status};
use super::drafts::stale_revision;
use super::revisions::{load_current_draft, pdf_matches_hash, revision_pdf};
use super::roles::has_role;
use crate::{ApiError, ApiResult, AppState, bad, check_origin, identity::session, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseInput {
    revision: i64,
}

/// Mental model: only the sender role can release, only the revision everyone approved, and
/// only with an intact PDF; release pins the content hash that dispatch will send.
pub async fn release_draft(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<ReleaseInput>,
) -> ApiResult<StatusCode> {
    check_origin(&state, &headers)?;
    let actor = session::require_officer(&state, &headers).await?;
    let draft = load_current_draft(&state, &id).await?;
    if draft.revision != input.revision {
        return Err(stale_revision());
    }
    if !is_editable_status(&draft.status) {
        return Err(bad("Draft is not releasable"));
    }
    ensure_pdf_intact(&state, &id, draft.revision, &draft.content).await?;
    if !has_role(&state, &actor.id, &draft.content.sender_role).await? {
        return Err(ApiError(StatusCode::FORBIDDEN, "Sender role required"));
    }
    ensure_approvals_complete(&state, &id, draft.revision, &draft.content).await?;
    queue_dispatch(&state, &id, draft.revision, &draft.content, &actor.id).await
}

async fn ensure_pdf_intact(
    state: &AppState,
    id: &str,
    revision: i64,
    content: &Content,
) -> ApiResult<()> {
    if content.pdf_text.is_none() {
        return Ok(());
    }
    let Some((Some(bytes), Some(hash))) = revision_pdf(state, id, revision).await? else {
        return Err(ApiError(StatusCode::PRECONDITION_FAILED, "PDF is missing"));
    };
    if !pdf_matches_hash(&bytes, &hash) {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "PDF integrity check failed",
        ));
    }
    Ok(())
}

async fn ensure_approvals_complete(
    state: &AppState,
    id: &str,
    revision: i64,
    content: &Content,
) -> ApiResult<()> {
    let approved: Vec<(String,)> = sqlx::query_as("SELECT a.role FROM mail_approvals a JOIN officer_roles r ON r.member_id=a.approver_id AND r.role=a.role WHERE a.draft_id=? AND a.revision=?")
        .bind(id).bind(revision).fetch_all(&state.db).await.map_err(internal)?;
    let complete = content
        .required_roles
        .iter()
        .all(|role| approved.iter().any(|row| &row.0 == role));
    if !complete {
        return Err(bad("Required approvals are incomplete"));
    }
    Ok(())
}

async fn queue_dispatch(
    state: &AppState,
    id: &str,
    revision: i64,
    content: &Content,
    actor_id: &str,
) -> ApiResult<StatusCode> {
    let mut tx = state.db.begin().await.map_err(internal)?;
    let changed = sqlx::query("UPDATE mail_drafts SET status='released',updated_at=? WHERE id=? AND current_revision=? AND status IN ('draft','ready')")
        .bind(chrono::Utc::now().to_rfc3339()).bind(id).bind(revision).execute(&mut *tx).await.map_err(internal)?.rows_affected();
    if changed != 1 {
        return Err(ApiError(StatusCode::PRECONDITION_FAILED, "Draft changed"));
    }
    sqlx::query("INSERT INTO mail_dispatch(draft_id,revision,content_hash,status,updated_at) VALUES (?,?,?,'pending',?)")
        .bind(id).bind(revision).bind(content_hash(content)?).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *tx).await.map_err(internal)?;
    sqlx::query("INSERT INTO audit_events(id,actor_id,operation,entity_id,revision,created_at) VALUES (?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(actor_id).bind("mail.released").bind(id).bind(revision)
        .bind(chrono::Utc::now().to_rfc3339()).execute(&mut *tx).await.map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}
