//! A member deletes one of their own achievements from the gallery. The review claim with the
//! same id and every point it earned go with it, so points always match the evidence shown.
//!
//! Module map (caller-first):
//!   delete_own_evidence   find the item in the member's own list → revoke → save the list
//!   ├─ take_item          remove the item from /evidence/items (only this member's view)
//!   ├─ revoke_claim       delete the claim, its points, and its stored photo; queue a refresh
//!   └─ owned_media_id     "/portal/media/{id}" → {id}
use crate::portal::store::{current, save};
use crate::{ApiError, ApiResult, identity::session::Viewer, internal};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use uuid::Uuid;

const CAREER_EVIDENCE_KEY: &str = "/api/product/career-evidence";
const MEDIA_PREFIX: &str = "/portal/media/";

// Mental model: a member can only reach items in their own saved view, so ownership is implied
// by where the item was found; the claim and points are then removed by (member, id) as well.
pub(crate) async fn delete_own_evidence(
    db: &SqlitePool,
    actor: &Viewer,
    id: &str,
) -> ApiResult<Value> {
    let mut view = current(db, &actor.role, &actor.id, CAREER_EVIDENCE_KEY).await?;
    let item = take_item(&mut view, id)?;
    let points_revoked = revoke_claim(db, actor, id, &item).await?;
    save(db, &actor.id, CAREER_EVIDENCE_KEY, &view).await?;
    tracing::info!(
        component = "evidence",
        operation = "member_delete",
        points_revoked,
        "evidence.member_deleted"
    );
    Ok(json!({"ok": true, "pointsRevoked": points_revoked}))
}

fn take_item(view: &mut Value, id: &str) -> ApiResult<Value> {
    let items = view
        .pointer_mut("/evidence/items")
        .and_then(Value::as_array_mut)
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Achievement not found"))?;
    let index = items
        .iter()
        .position(|item| item.get("id").and_then(Value::as_str) == Some(id))
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Achievement not found"))?;
    Ok(items.remove(index))
}

async fn revoke_claim(db: &SqlitePool, actor: &Viewer, id: &str, item: &Value) -> ApiResult<i64> {
    let mut tx = db.begin().await.map_err(internal)?;
    let (points,): (i64,) = sqlx::query_as("SELECT COALESCE(SUM(delta), 0) FROM point_ledger WHERE member_id = ? AND source_id = ? AND source_type = 'verified_evidence'")
        .bind(&actor.id).bind(id)
        .fetch_one(&mut *tx).await.map_err(internal)?;
    sqlx::query("DELETE FROM point_ledger WHERE member_id = ? AND source_id = ? AND source_type = 'verified_evidence'")
        .bind(&actor.id).bind(id)
        .execute(&mut *tx).await.map_err(internal)?;
    sqlx::query("DELETE FROM evidence_claims WHERE id = ? AND member_id = ?")
        .bind(id)
        .bind(&actor.id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    if let Some(media) = owned_media_id(item) {
        sqlx::query("DELETE FROM portal_media WHERE id = ? AND owner_id = ?")
            .bind(media)
            .bind(&actor.id)
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
    }
    let now = chrono::Utc::now().to_rfc3339();
    if points != 0 {
        sqlx::query("INSERT INTO jobs(id,kind,entity_id,status,available_at,created_at) VALUES (?,'leaderboard_refresh','global','pending',?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET status='pending',generation=jobs.generation+1,available_at=excluded.available_at,result=NULL,finished_at=NULL")
            .bind(Uuid::new_v4().to_string()).bind(&now).bind(&now)
            .execute(&mut *tx).await.map_err(internal)?;
    }
    sqlx::query("INSERT INTO audit_events(id,actor_id,operation,entity_id,revision,created_at) VALUES (?,?,'evidence.member_deleted',?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(&actor.id).bind(id).bind(points).bind(&now)
        .execute(&mut *tx).await.map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(points)
}

fn owned_media_id(item: &Value) -> Option<&str> {
    item.get("mediaUrl")?
        .as_str()?
        .strip_prefix(MEDIA_PREFIX)
        .filter(|id| !id.is_empty() && !id.contains('/'))
}
