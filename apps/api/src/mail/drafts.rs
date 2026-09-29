//! Drafting mail: create a draft on a route, read it, and edit it into new revisions.
//!
//! Module map (caller-first):
//!   create_draft              POST /mail/drafts
//!   └─ route_roles            the category's required roles and sender role
//!   read_draft                GET /mail/drafts/{id}
//!   └─ draft_view             content plus approvals, delivery state and PDF hash
//!   edit_draft                PATCH /mail/drafts/{id} (If-Match: current revision)
//!   ├─ expected_revision      the revision the client last saw
//!   ├─ apply_patch            changed fields only; an empty PDF text removes the PDF
//!   └─ store_next_revision    bumps the revision unless nothing actually changed
//!   require_draft_access      admins, the draft's creator, or holders of a routed role
use super::content::{Content, content_hash, is_editable_status, is_valid_content};
use super::revisions::{CurrentDraft, insert_revision, load_current_draft};
use super::roles::{has_role, is_admin};
use crate::{ApiError, ApiResult, AppState, bad, check_origin, identity::session, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewDraft {
    category: String,
    recipients: Vec<String>,
    subject: String,
    body: String,
    pdf_text: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRef {
    id: String,
    revision: i64,
    content_hash: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftPatch {
    recipients: Option<Vec<String>>,
    subject: Option<String>,
    body: Option<String>,
    pdf_text: Option<String>,
}

/// Mental model: the category's route decides who must approve and who sends; those roles
/// are copied into revision 1 so later route changes never alter an existing draft.
pub async fn create_draft(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<NewDraft>,
) -> ApiResult<(StatusCode, Json<DraftRef>)> {
    check_origin(&state, &headers)?;
    let actor = session::require_officer(&state, &headers).await?;
    if !is_valid_content(
        &input.recipients,
        &input.subject,
        &input.body,
        input.pdf_text.as_deref(),
    ) {
        return Err(bad("Invalid mail content"));
    }
    let (required_roles, sender_role) = route_roles(&state, &input.category).await?;
    let content = Content {
        recipients: input.recipients,
        subject: input.subject,
        body: input.body,
        pdf_text: input.pdf_text,
        required_roles,
        sender_role,
    };
    let hash = content_hash(&content)?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let mut tx = state.db.begin().await.map_err(internal)?;
    sqlx::query("INSERT INTO mail_drafts(id,category,created_by,current_revision,status,created_at,updated_at) VALUES (?,?,?,1,'draft',?,?)")
        .bind(&id).bind(&input.category).bind(&actor.id).bind(&now).bind(&now).execute(&mut *tx).await.map_err(internal)?;
    insert_revision(&mut tx, &id, 1, &content, &hash, &actor.id).await?;
    tx.commit().await.map_err(internal)?;
    Ok((
        StatusCode::CREATED,
        Json(DraftRef {
            id,
            revision: 1,
            content_hash: hash,
        }),
    ))
}

async fn route_roles(state: &AppState, category: &str) -> ApiResult<(Vec<String>, String)> {
    let route: Option<(String, String)> = sqlx::query_as(
        "SELECT required_roles_json,sender_role FROM mail_routes WHERE category = ?",
    )
    .bind(category)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    let Some((required_json, sender_role)) = route else {
        return Err(bad("Recipient category has no route"));
    };
    let required_roles: Vec<String> = serde_json::from_str(&required_json).map_err(internal)?;
    Ok((required_roles, sender_role))
}

pub async fn read_draft(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let actor = session::require_officer(&state, &headers).await?;
    let draft = load_current_draft(&state, &id).await?;
    require_draft_access(&state, &actor, &id, &draft.content).await?;
    Ok(Json(draft_view(&state, id, draft).await?))
}

async fn draft_view(
    state: &AppState,
    id: String,
    draft: CurrentDraft,
) -> ApiResult<serde_json::Value> {
    let approvals: Vec<(String,)> =
        sqlx::query_as("SELECT role FROM mail_approvals WHERE draft_id=? AND revision=?")
            .bind(&id)
            .bind(draft.revision)
            .fetch_all(&state.db)
            .await
            .map_err(internal)?;
    let delivery: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT status,claimed_at,external_message_id FROM mail_dispatch WHERE draft_id=?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    let pdf_hash: Option<(Option<String>,)> =
        sqlx::query_as("SELECT pdf_sha256 FROM mail_revisions WHERE draft_id=? AND revision=?")
            .bind(&id)
            .bind(draft.revision)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    Ok(
        serde_json::json!({"id": id, "revision": draft.revision, "status": draft.status, "contentHash": content_hash(&draft.content)?, "pdfSha256": pdf_hash.and_then(|row| row.0), "content": draft.content, "approvedRoles": approvals.into_iter().map(|row| row.0).collect::<Vec<_>>(), "delivery": delivery.map(|(status,claimed_at,external_message_id)| serde_json::json!({"status": status, "claimedAt": claimed_at, "externalMessageId": external_message_id})) }),
    )
}

/// Mental model: optimistic concurrency — the client names the revision it edited; a stale
/// revision, a released draft, or invalid content is refused, and an unchanged edit is a no-op.
pub async fn edit_draft(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(patch): Json<DraftPatch>,
) -> ApiResult<Json<DraftRef>> {
    check_origin(&state, &headers)?;
    let actor = session::require_officer(&state, &headers).await?;
    let expected = expected_revision(&headers)?;
    let CurrentDraft {
        revision,
        status,
        mut content,
    } = load_current_draft(&state, &id).await?;
    require_draft_access(&state, &actor, &id, &content).await?;
    if revision != expected {
        return Err(stale_revision());
    }
    if !is_editable_status(&status) {
        return Err(bad("Released draft cannot be edited"));
    }
    apply_patch(&mut content, patch);
    if !is_valid_content(
        &content.recipients,
        &content.subject,
        &content.body,
        content.pdf_text.as_deref(),
    ) {
        return Err(bad("Invalid mail content"));
    }
    let hash = content_hash(&content)?;
    let revision = store_next_revision(&state, &id, revision, &content, &hash, &actor.id).await?;
    Ok(Json(DraftRef {
        id,
        revision,
        content_hash: hash,
    }))
}

fn expected_revision(headers: &HeaderMap) -> ApiResult<i64> {
    headers
        .get("if-match")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim_matches('"').parse().ok())
        .ok_or(ApiError(
            StatusCode::PRECONDITION_REQUIRED,
            "If-Match revision required",
        ))
}

fn apply_patch(content: &mut Content, patch: DraftPatch) {
    if let Some(value) = patch.recipients {
        content.recipients = value;
    }
    if let Some(value) = patch.subject {
        content.subject = value;
    }
    if let Some(value) = patch.body {
        content.body = value;
    }
    if let Some(value) = patch.pdf_text {
        content.pdf_text = if value.is_empty() { None } else { Some(value) };
    }
}

/// Returns the revision the draft now points to: the same one when the content hash did not
/// change, otherwise the next one.
async fn store_next_revision(
    state: &AppState,
    id: &str,
    revision: i64,
    content: &Content,
    hash: &str,
    actor_id: &str,
) -> ApiResult<i64> {
    let old_hash: (String,) =
        sqlx::query_as("SELECT content_hash FROM mail_revisions WHERE draft_id=? AND revision=?")
            .bind(id)
            .bind(revision)
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;
    if old_hash.0 == hash {
        return Ok(revision);
    }
    let next_revision = revision + 1;
    let mut tx = state.db.begin().await.map_err(internal)?;
    let changed = sqlx::query("UPDATE mail_drafts SET current_revision=?,status='draft',updated_at=? WHERE id=? AND current_revision=? AND status IN ('draft','ready')")
        .bind(next_revision).bind(chrono::Utc::now().to_rfc3339()).bind(id).bind(revision)
        .execute(&mut *tx).await.map_err(internal)?.rows_affected();
    if changed != 1 {
        return Err(stale_revision());
    }
    insert_revision(&mut tx, id, next_revision, content, hash, actor_id).await?;
    tx.commit().await.map_err(internal)?;
    Ok(next_revision)
}

/// Mental model: admins see every draft; otherwise the creator, or anyone holding one of the
/// draft's required roles or its sender role.
pub(super) async fn require_draft_access(
    state: &AppState,
    actor: &session::Viewer,
    draft_id: &str,
    content: &Content,
) -> ApiResult<()> {
    if is_admin(actor) {
        return Ok(());
    }
    // created_by is NULL once the drafting officer's account is deleted.
    let creator: Option<(Option<String>,)> =
        sqlx::query_as("SELECT created_by FROM mail_drafts WHERE id=?")
            .bind(draft_id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    if creator.is_some_and(|row| row.0.as_deref() == Some(actor.id.as_str())) {
        return Ok(());
    }
    for role in content
        .required_roles
        .iter()
        .chain(std::iter::once(&content.sender_role))
    {
        if has_role(state, &actor.id, role).await? {
            return Ok(());
        }
    }
    Err(ApiError(StatusCode::FORBIDDEN, "Draft access denied"))
}

#[inline]
pub(super) fn stale_revision() -> ApiError {
    ApiError(StatusCode::PRECONDITION_FAILED, "Stale draft revision")
}
