//! The collaborative mail trail: who did what to which part, with before/after hashes.
use crate::{ApiResult, internal};
use sqlx::{Sqlite, Transaction};
use uuid::Uuid;

pub(crate) struct Change<'a> {
    pub(crate) draft_id: &'a str,
    pub(crate) actor_id: &'a str,
    pub(crate) action: &'a str,
    pub(crate) target_id: &'a str,
    pub(crate) from_hash: &'a str,
    pub(crate) to_hash: &'a str,
}

pub(crate) async fn record(tx: &mut Transaction<'_, Sqlite>, change: Change<'_>) -> ApiResult<()> {
    sqlx::query("INSERT INTO collab_audit(id, draft_id, actor_id, action, target_id, from_hash, to_hash, at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string())
        .bind(change.draft_id)
        .bind(change.actor_id)
        .bind(change.action)
        .bind(change.target_id)
        .bind(change.from_hash)
        .bind(change.to_hash)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    tracing::info!(
        component = "collab_mail",
        operation = change.action,
        "collab_mail.changed"
    );
    Ok(())
}
