//! From reviewed parts to a sent email: readiness, the Secretariat → President chain, and send.
//!
//! Module map (caller-first):
//!   advance            after any change: not ready → back to review (approvals cleared);
//!                      ready while in review → on to the Secretariat
//!   approve_step       the Secretary General, then the President, approve the exact assembled hash
//!   send_draft         the Communications Officer (or CMO) hands the email to mail delivery
//!   ├─ is_ready        every section and tag confirmed, every question answered
//!   └─ assembled_now   the current body and assembled hash
use super::{
    PRESIDENT, SECRETARIAT,
    access::{holds, sender_position},
    audit::{self, Change},
    model::assembled,
};
use crate::{ApiError, ApiResult, identity::session::Viewer, internal, mail::queue_assembled_mail};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::{Sqlite, SqlitePool, Transaction};

type Tx<'a> = Transaction<'a, Sqlite>;

// Mental model: the stage is recomputed from the parts after every change, so the chain can never
// hold an approval for text that has since changed.
pub(crate) async fn advance(tx: &mut Tx<'_>, draft_id: &str) -> ApiResult<()> {
    let stage = stage_of(tx, draft_id).await?;
    if stage == "queued" {
        return Ok(());
    }
    let ready = is_ready(tx, draft_id).await?;
    let (_, hash) = assembled_now(tx, draft_id).await?;
    // Approvals only count for the exact email they approved.
    sqlx::query("DELETE FROM collab_approvals WHERE draft_id = ? AND assembled_hash != ?")
        .bind(draft_id)
        .bind(&hash)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    let next = if !ready {
        "in_review"
    } else if !approved(tx, draft_id, "secretariat").await? {
        "secretariat"
    } else if !approved(tx, draft_id, "president").await? {
        "president"
    } else {
        "sending"
    };
    sqlx::query("UPDATE collab_drafts SET stage = ?, updated_at = ? WHERE id = ?")
        .bind(next)
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(draft_id)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}

pub(crate) async fn approve_step(
    db: &SqlitePool,
    actor: &Viewer,
    draft_id: &str,
    input: &Value,
) -> ApiResult<Value> {
    let mut tx = db.begin().await.map_err(internal)?;
    let (step, position) = match stage_of(&mut tx, draft_id).await?.as_str() {
        "secretariat" => ("secretariat", SECRETARIAT),
        "president" => ("president", PRESIDENT),
        _ => {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "This email is not waiting for an approval",
            ));
        }
    };
    if !holds(&mut tx, &actor.id, position).await? {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Only the position at this step can approve",
        ));
    }
    let hash = ensure_current(&mut tx, draft_id, input).await?;
    sqlx::query("INSERT OR REPLACE INTO collab_approvals(draft_id, step, approver_id, assembled_hash, approved_at) VALUES (?,?,?,?,?)")
        .bind(draft_id).bind(step).bind(&actor.id).bind(&hash).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *tx).await.map_err(internal)?;
    audit::record(
        &mut tx,
        Change {
            draft_id,
            actor_id: &actor.id,
            action: step,
            target_id: draft_id,
            from_hash: "",
            to_hash: &hash,
        },
    )
    .await?;
    advance(&mut tx, draft_id).await?;
    tx.commit().await.map_err(internal)?;
    Ok(json!({"ok": true}))
}

pub(crate) async fn send_draft(
    db: &SqlitePool,
    actor: &Viewer,
    draft_id: &str,
    input: &Value,
) -> ApiResult<Value> {
    let mut tx = db.begin().await.map_err(internal)?;
    if stage_of(&mut tx, draft_id).await? != "sending" {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "This email is not ready to send",
        ));
    }
    let sender = sender_position(&mut tx).await?;
    if !holds(&mut tx, &actor.id, sender).await? {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Only the Communications Officer (or the CMO) sends the email",
        ));
    }
    let hash = ensure_current(&mut tx, draft_id, input).await?;
    let (subject, recipients_json): (String, String) =
        sqlx::query_as("SELECT subject, recipients_json FROM collab_drafts WHERE id = ?")
            .bind(draft_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(internal)?;
    let recipients: Vec<String> = serde_json::from_str(&recipients_json).map_err(internal)?;
    let (body, _) = assembled_now(&mut tx, draft_id).await?;
    let mail_id = queue_assembled_mail(&mut tx, recipients, subject, body, &actor.id).await?;
    // One send per draft: the delivery row's primary key refuses a second hand-off.
    sqlx::query("INSERT INTO collab_deliveries(draft_id, mail_draft_id, assembled_hash, queued_by, queued_at) VALUES (?,?,?,?,?)")
        .bind(draft_id).bind(&mail_id).bind(&hash).bind(&actor.id).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *tx).await.map_err(|_| ApiError(StatusCode::CONFLICT, "This email was already sent"))?;
    sqlx::query("UPDATE collab_drafts SET stage = 'queued', updated_at = ? WHERE id = ?")
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(draft_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    audit::record(
        &mut tx,
        Change {
            draft_id,
            actor_id: &actor.id,
            action: "sent",
            target_id: &mail_id,
            from_hash: "",
            to_hash: &hash,
        },
    )
    .await?;
    tx.commit().await.map_err(internal)?;
    Ok(json!({"ok": true, "mailDraftId": mail_id}))
}

/// The client names the assembled hash it reviewed; a different current hash means it changed.
async fn ensure_current(tx: &mut Tx<'_>, draft_id: &str, input: &Value) -> ApiResult<String> {
    let (_, hash) = assembled_now(tx, draft_id).await?;
    if input.get("assembledHash").and_then(Value::as_str) != Some(hash.as_str()) {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "The email changed since you opened it; review the latest version",
        ));
    }
    Ok(hash)
}

pub(crate) async fn stage_of(tx: &mut Tx<'_>, draft_id: &str) -> ApiResult<String> {
    let stage: Option<(String,)> = sqlx::query_as("SELECT stage FROM collab_drafts WHERE id = ?")
        .bind(draft_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(internal)?;
    stage
        .map(|(stage,)| stage)
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Email draft not found"))
}

async fn is_ready(tx: &mut Tx<'_>, draft_id: &str) -> ApiResult<bool> {
    let (open,): (i64,) = sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM collab_sections WHERE draft_id = ?1 AND state != 'confirmed') \
         + (SELECT COUNT(*) FROM collab_tags t JOIN collab_sections s ON s.id = t.section_id WHERE s.draft_id = ?1 AND t.state != 'confirmed') \
         + (SELECT COUNT(*) FROM collab_questions q JOIN collab_sections s ON s.id = q.section_id LEFT JOIN collab_answers a ON a.question_id = q.id WHERE s.draft_id = ?1 AND a.question_id IS NULL)",
    )
    .bind(draft_id).fetch_one(&mut **tx).await.map_err(internal)?;
    Ok(open == 0)
}

async fn approved(tx: &mut Tx<'_>, draft_id: &str, step: &str) -> ApiResult<bool> {
    let found: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM collab_approvals WHERE draft_id = ? AND step = ?")
            .bind(draft_id)
            .bind(step)
            .fetch_optional(&mut **tx)
            .await
            .map_err(internal)?;
    Ok(found.is_some())
}

pub(crate) async fn assembled_now(tx: &mut Tx<'_>, draft_id: &str) -> ApiResult<(String, String)> {
    let (subject, recipients_json): (String, String) =
        sqlx::query_as("SELECT subject, recipients_json FROM collab_drafts WHERE id = ?")
            .bind(draft_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(internal)?;
    let sections: Vec<(String, String)> = sqlx::query_as(
        "SELECT content, content_hash FROM collab_sections WHERE draft_id = ? ORDER BY ord",
    )
    .bind(draft_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(internal)?;
    Ok(assembled(&subject, &recipients_json, &sections))
}
