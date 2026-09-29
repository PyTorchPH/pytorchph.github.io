//! Stored revisions of a draft, and the draft as it currently stands.
//!
//! Module map:
//!   insert_revision      writes one immutable revision (with its rendered PDF, if any)
//!   load_current_draft   the draft's current revision number, status and content
//!   revision_pdf         the stored PDF bytes and hash of one revision
//!   pdf_matches_hash     the stored PDF still matches the hash recorded with it
use super::{content::Content, pdf};
use crate::{ApiError, ApiResult, AppState, internal};
use axum::http::StatusCode;
use sha2::{Digest, Sha256};
use sqlx::{Row, Sqlite, Transaction};

pub(super) struct CurrentDraft {
    pub(super) revision: i64,
    pub(super) status: String,
    pub(super) content: Content,
}

pub(super) type StoredPdf = Option<(Option<Vec<u8>>, Option<String>)>;

pub(super) async fn insert_revision(
    tx: &mut Transaction<'_, Sqlite>,
    id: &str,
    revision: i64,
    content: &Content,
    hash: &str,
    actor_id: &str,
) -> ApiResult<()> {
    let pdf_bytes = content.pdf_text.as_deref().map(pdf::render).transpose()?;
    let pdf_hash = pdf_bytes
        .as_ref()
        .map(|bytes| hex::encode(Sha256::digest(bytes)));
    sqlx::query("INSERT INTO mail_revisions(draft_id,revision,recipients_json,subject,body,pdf_text,pdf_bytes,pdf_sha256,content_hash,required_roles_json,sender_role,edited_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(id).bind(revision).bind(serde_json::to_string(&content.recipients).map_err(internal)?)
        .bind(&content.subject).bind(&content.body).bind(&content.pdf_text).bind(pdf_bytes).bind(pdf_hash).bind(hash)
        .bind(serde_json::to_string(&content.required_roles).map_err(internal)?)
        .bind(&content.sender_role).bind(actor_id).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut **tx).await.map_err(internal)?;
    Ok(())
}

pub(super) async fn load_current_draft(state: &AppState, id: &str) -> ApiResult<CurrentDraft> {
    let row = sqlx::query("SELECT d.current_revision,d.status,r.recipients_json,r.subject,r.body,r.pdf_text,r.required_roles_json,r.sender_role FROM mail_drafts d JOIN mail_revisions r ON r.draft_id=d.id AND r.revision=d.current_revision WHERE d.id=?")
        .bind(id).fetch_optional(&state.db).await.map_err(internal)?
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Draft not found"))?;
    let content = Content {
        recipients: serde_json::from_str(row.get::<&str, _>(2)).map_err(internal)?,
        subject: row.get(3),
        body: row.get(4),
        pdf_text: row.get(5),
        required_roles: serde_json::from_str(row.get::<&str, _>(6)).map_err(internal)?,
        sender_role: row.get(7),
    };
    Ok(CurrentDraft {
        revision: row.get(0),
        status: row.get(1),
        content,
    })
}

pub(super) async fn revision_pdf(
    state: &AppState,
    id: &str,
    revision: i64,
) -> ApiResult<StoredPdf> {
    sqlx::query_as(
        "SELECT pdf_bytes,pdf_sha256 FROM mail_revisions WHERE draft_id=? AND revision=?",
    )
    .bind(id)
    .bind(revision)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)
}

#[inline]
pub(super) fn pdf_matches_hash(bytes: &[u8], hash: &str) -> bool {
    hex::encode(Sha256::digest(bytes)) == hash
}
