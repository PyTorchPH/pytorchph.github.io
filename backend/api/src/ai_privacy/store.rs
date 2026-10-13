//! Consent revisions invalidate outstanding tickets on revoke/regrant; expired mappings are bounded.
use super::{Ticket, key::PrivacyKey};
use crate::{ApiError, ApiResult, bad, internal};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

pub(crate) fn purpose(value: &str) -> ApiResult<()> {
    if ["learning_recommendations", "officer_assistant"].contains(&value) {
        Ok(())
    } else {
        Err(bad("Unsupported AI purpose"))
    }
}

pub(crate) async fn consents(db: &SqlitePool, member: &str) -> ApiResult<Value> {
    let rows: Vec<(String, bool)> =
        sqlx::query_as("SELECT purpose,granted FROM ai_privacy_consents WHERE member_id=?")
            .bind(member)
            .fetch_all(db)
            .await
            .map_err(internal)?;
    let mut result =
        json!({"learning_recommendations":false,"officer_assistant":false,"model_training":false});
    for (purpose, granted) in rows {
        result[&purpose] = json!(granted);
    }
    Ok(result)
}

pub(crate) async fn save_consent(
    db: &SqlitePool,
    member: &str,
    purpose: &str,
    granted: bool,
) -> ApiResult<()> {
    let mut tx = db.begin().await.map_err(internal)?;
    sqlx::query("INSERT INTO ai_privacy_consents(member_id,purpose,granted,revision,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(member_id,purpose) DO UPDATE SET granted=excluded.granted,revision=revision+1,updated_at=excluded.updated_at")
        .bind(member).bind(purpose).bind(granted).bind(chrono::Utc::now().to_rfc3339()).execute(&mut *tx).await.map_err(internal)?;
    sqlx::query("DELETE FROM ai_projection_requests WHERE member_id=? AND purpose=?")
        .bind(member)
        .bind(purpose)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "ai_privacy",
        operation = "consent",
        purpose,
        granted,
        "ai_privacy.consent_updated"
    );
    Ok(())
}

pub(crate) async fn allowed(db: &SqlitePool, member: &str, purpose: &str) -> ApiResult<i64> {
    sqlx::query_scalar(
        "SELECT revision FROM ai_privacy_consents WHERE member_id=? AND purpose=? AND granted=1",
    )
    .bind(member)
    .bind(purpose)
    .fetch_optional(db)
    .await
    .map_err(internal)?
    .ok_or(ApiError(
        StatusCode::FORBIDDEN,
        "Explicit AI purpose consent required",
    ))
}

pub(crate) async fn issue(
    db: &SqlitePool,
    key: &PrivacyKey,
    member: &str,
    purpose: &str,
    revision: i64,
    payload: &Value,
) -> ApiResult<Value> {
    let encoded = serde_json::to_string(payload).map_err(internal)?;
    if encoded.len() > 128 * 1024 {
        return Err(bad("AI projection exceeds byte limit"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let expiry = chrono::Utc::now().timestamp() + 300;
    let alias = key.alias(purpose, "member", member)?;
    let hash = hex::encode(Sha256::digest(encoded.as_bytes()));
    let proof = key.sign(&[
        "ticket",
        &id,
        member,
        purpose,
        &revision.to_string(),
        &expiry.to_string(),
        &hash,
    ])?;
    let mut tx = db.begin().await.map_err(internal)?;
    sqlx::query(
        "DELETE FROM ai_projection_requests WHERE expires_at<=? OR (member_id=? AND purpose=?)",
    )
    .bind(chrono::Utc::now().timestamp())
    .bind(member)
    .bind(purpose)
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    sqlx::query("INSERT INTO ai_projection_requests VALUES(?,?,?,?,?,?,?,?)")
        .bind(&id)
        .bind(member)
        .bind(purpose)
        .bind(revision)
        .bind(alias)
        .bind(&key.version)
        .bind(&encoded)
        .bind(expiry)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "ai_privacy",
        operation = "project",
        purpose,
        policy_version = super::policy::POLICY_VERSION,
        bytes = encoded.len(),
        "ai_privacy.projection_created"
    );
    Ok(json!({"id":id,"proof":proof}))
}

pub(crate) async fn verify(db: &SqlitePool, key: &PrivacyKey, ticket: &Ticket) -> ApiResult<Value> {
    if uuid::Uuid::parse_str(&ticket.id).is_err() || ticket.proof.len() != 64 {
        return Err(bad("Invalid AI projection capability"));
    }
    let row:Option<(String,String,i64,String,i64,String)>=sqlx::query_as("SELECT r.member_id,r.purpose,r.consent_revision,r.payload_json,r.expires_at,r.key_version FROM ai_projection_requests r JOIN ai_privacy_consents c ON c.member_id=r.member_id AND c.purpose=r.purpose JOIN members m ON m.id=r.member_id WHERE r.id=? AND r.expires_at>? AND c.granted=1 AND c.revision=r.consent_revision AND m.role!='pending'")
        .bind(&ticket.id).bind(chrono::Utc::now().timestamp()).fetch_optional(db).await.map_err(internal)?;
    let (member, purpose, revision, payload, expiry, version) = row.ok_or(ApiError(
        StatusCode::FORBIDDEN,
        "AI projection expired or revoked",
    ))?;
    if version != key.version {
        return Err(ApiError(StatusCode::FORBIDDEN, "AI privacy key rotated"));
    }
    let hash = hex::encode(Sha256::digest(payload.as_bytes()));
    key.verify(
        &[
            "ticket",
            &ticket.id,
            &member,
            &purpose,
            &revision.to_string(),
            &expiry.to_string(),
            &hash,
        ],
        &ticket.proof,
    )?;
    if purpose == "officer_assistant" {
        let role: String = sqlx::query_scalar("SELECT role FROM members WHERE id=?")
            .bind(member)
            .fetch_one(db)
            .await
            .map_err(internal)?;
        if !crate::portal::is_officer(&role) {
            return Err(ApiError(StatusCode::FORBIDDEN, "Officer access revoked"));
        }
    }
    let value: Value = serde_json::from_str(&payload).map_err(internal)?;
    if value.get("policyVersion").and_then(Value::as_str) != Some(super::policy::POLICY_VERSION) {
        return Err(ApiError(StatusCode::FORBIDDEN, "AI field policy changed"));
    }
    Ok(value)
}

pub(crate) async fn resolve(db: &SqlitePool, member: &str, id: &str) -> ApiResult<Value> {
    let row:Option<(String,String)>=sqlx::query_as("SELECT r.subject_alias,r.payload_json FROM ai_projection_requests r JOIN ai_privacy_consents c ON c.member_id=r.member_id AND c.purpose=r.purpose JOIN members m ON m.id=r.member_id WHERE r.id=? AND r.member_id=? AND r.expires_at>? AND c.granted=1 AND c.revision=r.consent_revision AND (r.purpose!='officer_assistant' OR m.role IN ('officer','admin'))")
        .bind(id).bind(member).bind(chrono::Utc::now().timestamp()).fetch_optional(db).await.map_err(internal)?;
    let (alias, payload) = row.ok_or(ApiError(
        StatusCode::NOT_FOUND,
        "Owned AI request unavailable",
    ))?;
    let payload: Value = serde_json::from_str(&payload).map_err(internal)?;
    // Original names remain in the identity service; the caller already has owner access.
    Ok(json!({"requestId":id,"subjectAlias":alias,"projection":payload["projection"],"owned":true}))
}
