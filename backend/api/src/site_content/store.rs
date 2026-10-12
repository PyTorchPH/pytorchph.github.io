//! Immutable website revisions, optimistic editing and current-president publication quorum.
use super::{model, programs};
use crate::{
    ApiError, ApiResult, bad,
    identity::session::Viewer,
    internal,
    organization::{presidency, tree},
};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::SqlitePool;

pub(crate) async fn published(db: &SqlitePool) -> ApiResult<Value> {
    let (revision, body, at): (i64, String, String) = sqlx::query_as("SELECT r.revision,r.body_json,r.created_at FROM site_content_state s JOIN site_content_revisions r ON r.revision=s.published_revision WHERE s.id=1")
        .fetch_one(db).await.map_err(internal)?;
    let stored = serde_json::from_str::<Value>(&body).map_err(internal)?;
    let mut document = model::dynamic_document(&stored)?;
    programs::merge(db, &mut document).await?;
    Ok(json!({"revision":revision,"updatedAt":at,"document":document}))
}

pub(crate) async fn draft(db: &SqlitePool, actor: &Viewer) -> ApiResult<Value> {
    officer(actor)?;
    let (revision, published, body): (i64, i64, String) = sqlx::query_as("SELECT s.draft_revision,s.published_revision,r.body_json FROM site_content_state s JOIN site_content_revisions r ON r.revision=s.draft_revision WHERE s.id=1")
        .fetch_one(db).await.map_err(internal)?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(DISTINCT a.approver_id) FROM site_content_approvals a JOIN member_positions p ON p.member_id=a.approver_id AND p.position_slug='president' WHERE a.revision=?")
        .bind(revision).fetch_one(db).await.map_err(internal)?;
    let mut tx = db.begin().await.map_err(internal)?;
    let can_approve = tree::holds(&mut tx, &actor.id, "president").await?;
    tx.commit().await.map_err(internal)?;
    let stored = serde_json::from_str::<Value>(&body).map_err(internal)?;
    let mut document = model::dynamic_document(&stored)?;
    programs::merge(db, &mut document).await?;
    Ok(
        json!({"revision":revision,"publishedRevision":published,"document":document,"approvals":count,"requiredApprovals":presidency::required(db).await?,"canApprove":can_approve}),
    )
}

pub(crate) async fn save(db: &SqlitePool, actor: &Viewer, input: &Value) -> ApiResult<Value> {
    officer(actor)?;
    let revision = revision(input)?;
    let document = input
        .get("document")
        .ok_or(bad("Website document required"))?;
    model::validate(document)?;
    let mut tx = db.begin().await.map_err(internal)?;
    let changed=sqlx::query("UPDATE site_content_state SET draft_revision=draft_revision WHERE id=1 AND draft_revision=?")
        .bind(revision).execute(&mut *tx).await.map_err(internal)?;
    if changed.rows_affected() != 1 {
        return Err(stale());
    }
    let next = revision + 1;
    sqlx::query("INSERT INTO site_content_revisions VALUES (?,?,?,?)")
        .bind(next)
        .bind(document.to_string())
        .bind(&actor.id)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    sqlx::query("UPDATE site_content_state SET draft_revision=? WHERE id=1")
        .bind(next)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(component="site_content", operation="save", revision=next, actor_id=%actor.id, "site_content.draft_saved");
    draft(db, actor).await
}

// Mental model: lock current revision → authorize current president → idempotent vote → publish at quorum.
pub(crate) async fn approve(db: &SqlitePool, actor: &Viewer, input: &Value) -> ApiResult<Value> {
    officer(actor)?;
    let revision = revision(input)?;
    let mut tx = db.begin().await.map_err(internal)?;
    let changed=sqlx::query("UPDATE site_content_state SET draft_revision=draft_revision WHERE id=1 AND draft_revision=?")
        .bind(revision).execute(&mut *tx).await.map_err(internal)?;
    if changed.rows_affected() != 1 {
        return Err(stale());
    }
    if !tree::holds(&mut tx, &actor.id, "president").await? {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Only current presidents approve website publication",
        ));
    }
    sqlx::query("INSERT OR IGNORE INTO site_content_approvals VALUES (?,?,?)")
        .bind(revision)
        .bind(&actor.id)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let count: i64=sqlx::query_scalar("SELECT COUNT(DISTINCT a.approver_id) FROM site_content_approvals a JOIN member_positions p ON p.member_id=a.approver_id AND p.position_slug='president' WHERE a.revision=?")
        .bind(revision).fetch_one(&mut *tx).await.map_err(internal)?;
    let required = presidency::required_in(&mut tx).await?;
    let published = count >= required;
    if published {
        sqlx::query("UPDATE site_content_state SET published_revision=? WHERE id=1")
            .bind(revision)
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
    }
    tx.commit().await.map_err(internal)?;
    tracing::info!(component="site_content", operation="approve", revision, published, approvals=count, required, actor_id=%actor.id, "site_content.approval_recorded");
    draft(db, actor).await
}

fn officer(actor: &Viewer) -> ApiResult<()> {
    if !crate::portal::is_officer(&actor.role) {
        return Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"));
    }
    Ok(())
}

fn revision(input: &Value) -> ApiResult<i64> {
    input
        .get("revision")
        .and_then(Value::as_i64)
        .filter(|n| *n > 0 && *n < i64::MAX)
        .ok_or(bad("Valid revision required"))
}

fn stale() -> ApiError {
    ApiError(
        StatusCode::CONFLICT,
        "Website draft changed; reload before saving or approving",
    )
}
