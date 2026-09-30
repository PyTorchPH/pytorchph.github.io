//! Hand-off from collaborative drafting: an email already reviewed and approved elsewhere enters
//! mail delivery as a released draft with one revision and a pending dispatch job, so the existing
//! delivery workflow sends exactly this content (and only while live email is enabled).
use super::content::{Content, content_hash, is_valid_content};
use super::revisions::insert_revision;
use crate::{ApiResult, bad, internal};
use sqlx::{Sqlite, Transaction};
use uuid::Uuid;

const COLLABORATIVE_CATEGORY: &str = "collaborative_event";
const COLLABORATIVE_SENDER: &str = "communications";

pub(crate) async fn queue_assembled_mail(
    tx: &mut Transaction<'_, Sqlite>,
    recipients: Vec<String>,
    subject: String,
    body: String,
    actor_id: &str,
) -> ApiResult<String> {
    if !is_valid_content(&recipients, &subject, &body, None) {
        return Err(bad(
            "The assembled email is not valid mail (check recipients, subject, and length)",
        ));
    }
    let content = Content {
        recipients,
        subject,
        body,
        pdf_text: None,
        required_roles: Vec::new(),
        sender_role: COLLABORATIVE_SENDER.to_owned(),
    };
    let hash = content_hash(&content)?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    // The route exists only so the draft row has a category; approval already happened upstream.
    sqlx::query("INSERT OR IGNORE INTO mail_routes(category, required_roles_json, sender_role, updated_by, updated_at) VALUES (?, '[]', ?, NULL, ?)")
        .bind(COLLABORATIVE_CATEGORY).bind(COLLABORATIVE_SENDER).bind(&now)
        .execute(&mut **tx).await.map_err(internal)?;
    sqlx::query("INSERT INTO mail_drafts(id,category,created_by,current_revision,status,created_at,updated_at) VALUES (?,?,?,1,'released',?,?)")
        .bind(&id).bind(COLLABORATIVE_CATEGORY).bind(actor_id).bind(&now).bind(&now)
        .execute(&mut **tx).await.map_err(internal)?;
    insert_revision(tx, &id, 1, &content, &hash, actor_id).await?;
    sqlx::query("INSERT INTO mail_dispatch(draft_id,revision,content_hash,status,updated_at) VALUES (?,1,?,'pending',?)")
        .bind(&id).bind(&hash).bind(&now)
        .execute(&mut **tx).await.map_err(internal)?;
    sqlx::query("INSERT INTO audit_events(id,actor_id,operation,entity_id,revision,created_at) VALUES (?,?,'mail.collaborative_released',?,1,?)")
        .bind(Uuid::new_v4().to_string()).bind(actor_id).bind(&id).bind(&now)
        .execute(&mut **tx).await.map_err(internal)?;
    Ok(id)
}
