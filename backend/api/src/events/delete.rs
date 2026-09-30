//! Deleting an event for good, with an audit snapshot that outlives it.
//!
//! Module map (caller-first):
//!   delete_event          authorize → snapshot → delete (cascades) → refresh leaderboard → log
//!   ├─ may_delete         the President, an admin, or the officer who created the event
//!   ├─ snapshot           what the delete removes: sub-events, entrants, results, responses, points
//!   └─ log_deletion       event_deletion_log row (no foreign keys)
//!   officer_event_list    events with a per-viewer "canDelete", plus the deletions they may see
use crate::{ApiError, ApiResult, identity::session::Viewer, internal, organization::tree};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::{Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

type Tx<'a> = Transaction<'a, Sqlite>;

const LIST_LIMIT: i64 = 200;
const LOG_LIMIT: i64 = 100;

struct Snapshot {
    title: String,
    category: String,
    starts_at: String,
    created_by: String,
    child_events: i64,
    entrants: i64,
    results: i64,
    attendance_responses: i64,
    points_revoked: i64,
    members_affected: i64,
}

// Mental model: take the snapshot inside the same transaction as the delete, so the log always
// describes exactly what was removed.
pub(crate) async fn delete_event(
    db: &SqlitePool,
    actor: &Viewer,
    event_id: &str,
) -> ApiResult<Value> {
    let mut tx = db.begin().await.map_err(internal)?;
    let snapshot = snapshot(&mut tx, event_id).await?;
    if !may_delete(&mut tx, actor, &snapshot.created_by).await? {
        tracing::warn!(
            component = "events",
            operation = "delete",
            "events.delete_denied"
        );
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Only the President, an admin, or the officer who created this event can delete it",
        ));
    }
    sqlx::query("DELETE FROM events WHERE id = ?")
        .bind(event_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    queue_leaderboard_refresh(&mut tx).await?;
    log_deletion(&mut tx, event_id, &snapshot, actor).await?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "events",
        operation = "delete",
        points_revoked = snapshot.points_revoked,
        "events.deleted"
    );
    Ok(
        json!({"ok": true, "pointsRevoked": snapshot.points_revoked, "membersAffected": snapshot.members_affected}),
    )
}

async fn may_delete(tx: &mut Tx<'_>, actor: &Viewer, created_by: &str) -> ApiResult<bool> {
    Ok(actor.role == "admin"
        || actor.id == created_by
        || tree::holds(tx, &actor.id, "president").await?)
}

async fn snapshot(tx: &mut Tx<'_>, event_id: &str) -> ApiResult<Snapshot> {
    let event: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT title, category, starts_at, COALESCE(created_by, '') FROM events WHERE id = ?",
    )
    .bind(event_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal)?;
    let (title, category, starts_at, created_by) =
        event.ok_or(ApiError(StatusCode::NOT_FOUND, "Event not found"))?;
    // The event and its sub-events: everything the cascade removes.
    const FAMILY: &str = "(SELECT id FROM events WHERE id = ?1 OR parent_id = ?1)";
    let mut counts = Vec::new();
    for sql in [
        "SELECT COUNT(*) - 1 FROM events WHERE id = ?1 OR parent_id = ?1".to_owned(),
        format!("SELECT COUNT(*) FROM entrants WHERE event_id IN {FAMILY}"),
        format!("SELECT COUNT(*) FROM results WHERE event_id IN {FAMILY}"),
        format!("SELECT COUNT(*) FROM attendance_responses WHERE event_id IN {FAMILY}"),
        format!("SELECT COALESCE(SUM(delta), 0) FROM point_ledger WHERE event_id IN {FAMILY}"),
        format!("SELECT COUNT(DISTINCT member_id) FROM point_ledger WHERE event_id IN {FAMILY}"),
    ] {
        let (value,): (i64,) = sqlx::query_as(sqlx::AssertSqlSafe(sql))
            .bind(event_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(internal)?;
        counts.push(value);
    }
    Ok(Snapshot {
        title,
        category,
        starts_at,
        created_by,
        child_events: counts[0],
        entrants: counts[1],
        results: counts[2],
        attendance_responses: counts[3],
        points_revoked: counts[4],
        members_affected: counts[5],
    })
}

async fn queue_leaderboard_refresh(tx: &mut Tx<'_>) -> ApiResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO jobs(id,kind,entity_id,status,available_at,created_at) VALUES (?,'leaderboard_refresh','global','pending',?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET status='pending',generation=jobs.generation+1,available_at=excluded.available_at,result=NULL,finished_at=NULL")
        .bind(Uuid::new_v4().to_string())
        .bind(&now)
        .bind(&now)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}

async fn log_deletion(
    tx: &mut Tx<'_>,
    event_id: &str,
    snapshot: &Snapshot,
    actor: &Viewer,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO event_deletion_log(id,event_id,title,category,starts_at,created_by,deleted_by,deleted_by_name,child_events,entrants,results,attendance_responses,points_revoked,members_affected,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(event_id).bind(&snapshot.title).bind(&snapshot.category)
        .bind(&snapshot.starts_at).bind(&snapshot.created_by).bind(&actor.id).bind(&actor.display_name)
        .bind(snapshot.child_events).bind(snapshot.entrants).bind(snapshot.results)
        .bind(snapshot.attendance_responses).bind(snapshot.points_revoked).bind(snapshot.members_affected)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}

/// Officer view: every event with whether this viewer may delete it, and the deletion records
/// this viewer may see (events they created or deleted; admins see all).
pub(crate) async fn officer_event_list(db: &SqlitePool, viewer: &Viewer) -> ApiResult<Value> {
    let mut tx = db.begin().await.map_err(internal)?;
    let is_president = tree::holds(&mut tx, &viewer.id, "president").await?;
    tx.commit().await.map_err(internal)?;
    let is_admin = viewer.role == "admin";
    let events: Vec<(String, String, String, String, String, String)> = sqlx::query_as(
        "SELECT e.id, e.title, e.category, e.starts_at, COALESCE(e.created_by, ''), COALESCE(m.display_name, 'Former member') \
         FROM events e LEFT JOIN members m ON m.id = e.created_by WHERE e.parent_id IS NULL ORDER BY e.starts_at DESC LIMIT ?",
    )
    .bind(LIST_LIMIT)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    let log: Vec<(String, String, String, String, i64, i64, String)> = sqlx::query_as(
        "SELECT title, category, starts_at, deleted_by_name, points_revoked, members_affected, deleted_at FROM event_deletion_log \
         WHERE ?1 OR created_by = ?2 OR deleted_by = ?2 ORDER BY deleted_at DESC LIMIT ?3",
    )
    .bind(is_admin)
    .bind(&viewer.id)
    .bind(LOG_LIMIT)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    Ok(json!({
        "events": events.into_iter().map(|(id, title, category, starts_at, created_by, creator)| json!({
            "id": id, "title": title, "category": category, "startsAt": starts_at, "createdBy": creator,
            "canDelete": is_admin || is_president || created_by == viewer.id,
        })).collect::<Vec<_>>(),
        "deletions": log.into_iter().map(|(title, category, starts_at, deleted_by, points, members, at)| json!({
            "title": title, "category": category, "startsAt": starts_at, "deletedBy": deleted_by,
            "pointsRevoked": points, "membersAffected": members, "deletedAt": at,
        })).collect::<Vec<_>>(),
    }))
}
