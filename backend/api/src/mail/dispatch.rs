//! Delivery: the external workflow claims released mail and reports what happened; admins
//! reconcile deliveries whose outcome is unclear.
//!
//! Module map (caller-first):
//!   claim_dispatch               POST /internal/mail/claim (workflow key)
//!   └─ claimed_job               recipients, subject, body and PDF hash of the pinned revision
//!   record_receipt               POST /internal/mail/{id}/receipt (workflow key)
//!   └─ is_valid_outcome          sent/uncertain/failed; "sent" needs a message id
//!   reconcile_dispatch           POST /mail/drafts/{id}/reconcile (admin)
//!   ├─ is_valid_reconciliation   outcome, a 10–500 character reason, bounded message id
//!   └─ record_reconciliation     dispatch, draft, reconciliation row and audit, together
//!   check_workflow_key           live email on, and the shared key matches in constant time
use super::content::{is_delivery_outcome, names_sent_message};
use super::roles::is_admin;
use crate::{ApiError, ApiResult, AppState, bad, check_origin, identity::session, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use sqlx::{Row, Sqlite, Transaction};
use std::sync::Arc;
use subtle::ConstantTimeEq;
use uuid::Uuid;

const MIN_REASON_LENGTH: usize = 10;
const MAX_REASON_LENGTH: usize = 500;
const MAX_MESSAGE_ID_LENGTH: usize = 255;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    status: String,
    external_message_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReconcileInput {
    status: String,
    reason: String,
    external_message_id: Option<String>,
}

/// Mental model: take the oldest pending dispatch, mark it claimed, and hand the workflow the
/// exact revision whose content hash was pinned at release.
pub async fn claim_dispatch(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    check_workflow_key(&state, &headers)?;
    let mut tx = state.db.begin().await.map_err(internal)?;
    let row: Option<(String, i64, String)> = sqlx::query_as("SELECT draft_id,revision,content_hash FROM mail_dispatch WHERE status='pending' ORDER BY updated_at LIMIT 1")
        .fetch_optional(&mut *tx).await.map_err(internal)?;
    let Some((id, revision, hash)) = row else {
        return Ok(Json(serde_json::json!({"job": null})));
    };
    sqlx::query("UPDATE mail_dispatch SET status='claimed',claimed_at=?,updated_at=? WHERE draft_id=? AND status='pending'")
        .bind(chrono::Utc::now().to_rfc3339()).bind(chrono::Utc::now().to_rfc3339()).bind(&id)
        .execute(&mut *tx).await.map_err(internal)?;
    let job = claimed_job(&mut tx, id, revision, &hash).await?;
    tx.commit().await.map_err(internal)?;
    Ok(Json(serde_json::json!({ "job": job })))
}

async fn claimed_job(
    tx: &mut Transaction<'_, Sqlite>,
    id: String,
    revision: i64,
    hash: &str,
) -> ApiResult<serde_json::Value> {
    let row = sqlx::query("SELECT recipients_json,subject,body,pdf_sha256 FROM mail_revisions WHERE draft_id=? AND revision=? AND content_hash=?")
        .bind(&id).bind(revision).bind(hash).fetch_one(&mut **tx).await.map_err(internal)?;
    let recipients: Vec<String> = serde_json::from_str(row.get::<&str, _>(0)).map_err(internal)?;
    let subject: String = row.get(1);
    let body: String = row.get(2);
    let pdf_sha256: Option<String> = row.get(3);
    let has_pdf = pdf_sha256.is_some();
    Ok(
        serde_json::json!({"id": id, "revision": revision, "recipients": recipients, "subject": subject, "body": body, "pdfSha256": pdf_sha256, "hasPdf": has_pdf}),
    )
}

/// Mental model: only a claimed dispatch accepts a receipt, and the draft takes the same final
/// status.
pub async fn record_receipt(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<Receipt>,
) -> ApiResult<StatusCode> {
    check_workflow_key(&state, &headers)?;
    if !is_valid_outcome(&input.status, input.external_message_id.as_deref()) {
        return Err(bad("Invalid delivery receipt"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    let changed = sqlx::query("UPDATE mail_dispatch SET status=?,external_message_id=?,updated_at=? WHERE draft_id=? AND status='claimed'")
        .bind(&input.status).bind(&input.external_message_id).bind(chrono::Utc::now().to_rfc3339()).bind(&id)
        .execute(&mut *tx).await.map_err(internal)?.rows_affected();
    if changed != 1 {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "Dispatch is not claimed",
        ));
    }
    set_draft_status(&mut tx, &id, &input.status).await?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(draft_id = %id, status = %input.status, "mail.dispatch_result");
    Ok(StatusCode::NO_CONTENT)
}

#[inline]
fn is_valid_outcome(status: &str, external_message_id: Option<&str>) -> bool {
    is_delivery_outcome(status) && names_sent_message(status, external_message_id)
}

/// Mental model: an admin settles a claimed, uncertain or failed delivery by hand, with a
/// written reason that is kept alongside the audit trail.
pub async fn reconcile_dispatch(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<ReconcileInput>,
) -> ApiResult<StatusCode> {
    check_origin(&state, &headers)?;
    let actor = session::viewer(&state, &headers).await?;
    if !is_admin(&actor) {
        return Err(ApiError(StatusCode::FORBIDDEN, "Admin access required"));
    }
    if !is_valid_reconciliation(&input) {
        return Err(bad("Invalid reconciliation record"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    record_reconciliation(&mut tx, &id, &input, &actor.id).await?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(draft_id = %id, actor_id = %actor.id, status = %input.status, "mail.reconciled");
    Ok(StatusCode::NO_CONTENT)
}

#[inline]
fn is_valid_reconciliation(input: &ReconcileInput) -> bool {
    is_delivery_outcome(&input.status)
        && input.reason.trim().len() >= MIN_REASON_LENGTH
        && input.reason.len() <= MAX_REASON_LENGTH
        && !input
            .external_message_id
            .as_ref()
            .is_some_and(|id| id.len() > MAX_MESSAGE_ID_LENGTH)
        && names_sent_message(&input.status, input.external_message_id.as_deref())
}

async fn record_reconciliation(
    tx: &mut Transaction<'_, Sqlite>,
    id: &str,
    input: &ReconcileInput,
    actor_id: &str,
) -> ApiResult<()> {
    let changed = sqlx::query("UPDATE mail_dispatch SET status=?,external_message_id=?,updated_at=? WHERE draft_id=? AND status IN ('claimed','uncertain','failed')")
        .bind(&input.status).bind(&input.external_message_id).bind(chrono::Utc::now().to_rfc3339()).bind(id)
        .execute(&mut **tx).await.map_err(internal)?.rows_affected();
    if changed != 1 {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "Dispatch is not reconcilable",
        ));
    }
    set_draft_status(tx, id, &input.status).await?;
    sqlx::query("INSERT INTO mail_reconciliations(id,draft_id,status,reason,external_message_id,actor_id,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(id).bind(&input.status).bind(input.reason.trim())
        .bind(&input.external_message_id).bind(actor_id).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut **tx).await.map_err(internal)?;
    sqlx::query(
        "INSERT INTO audit_events(id,actor_id,operation,entity_id,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(actor_id)
    .bind(format!("mail.reconciled.{}", input.status))
    .bind(id)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(&mut **tx)
    .await
    .map_err(internal)?;
    Ok(())
}

async fn set_draft_status(
    tx: &mut Transaction<'_, Sqlite>,
    id: &str,
    status: &str,
) -> ApiResult<()> {
    sqlx::query("UPDATE mail_drafts SET status=?,updated_at=? WHERE id=?")
        .bind(status)
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}

pub(super) fn check_workflow_key(state: &AppState, headers: &HeaderMap) -> ApiResult<()> {
    if !state.live_email_enabled {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "Live email disabled",
        ));
    }
    let expected = state.workflow_key.as_ref().ok_or(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Workflow key missing",
    ))?;
    let provided = headers
        .get("x-workflow-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !is_matching_key(provided, expected) {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "Workflow key invalid"));
    }
    Ok(())
}

#[inline]
fn is_matching_key(provided: &str, expected: &str) -> bool {
    provided.len() == expected.len() && bool::from(provided.as_bytes().ct_eq(expected.as_bytes()))
}
