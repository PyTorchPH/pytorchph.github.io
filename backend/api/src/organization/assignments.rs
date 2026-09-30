//! Assigning, removing, and resigning positions down the org chart.
//!
//! Module map (caller-first):
//!   assign_position   the actor manages the position → the member takes it (seat rules apply)
//!   remove_holder     the actor manages the position → the member leaves it
//!   resign_position   a member leaves their own position
//!   └─ each one: authorize → change member_positions → sync_member_role → log, in one transaction
//!       ├─ ensure_manages      the delegation rule (tree::manages); no admin bypass
//!       ├─ ensure_seat_free    a 'one' seat must be empty
//!       ├─ member_name         for the audit log (kept after the member is gone)
//!       └─ log_change          position_assignment_log row
use super::{role_sync::sync_member_role, tree};
use crate::{ApiError, ApiResult, identity::session::Viewer, internal};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::{Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

type Tx<'a> = Transaction<'a, Sqlite>;

// Mental model: only the holder of the parent position may fill a child position, never their
// own seat, and a single-seat position must be vacated first.
pub(crate) async fn assign_position(
    db: &SqlitePool,
    actor: &Viewer,
    member_id: &str,
    position: &str,
) -> ApiResult<Value> {
    if member_id == actor.id {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "You cannot assign a position to yourself",
        ));
    }
    let mut tx = db.begin().await.map_err(internal)?;
    ensure_manages(&mut tx, actor, position).await?;
    ensure_seat_free(&mut tx, position).await?;
    let name = member_name(&mut tx, member_id).await?;
    let added = sqlx::query("INSERT OR IGNORE INTO member_positions(member_id, position_slug, assigned_at) VALUES (?, ?, ?)")
        .bind(member_id)
        .bind(position)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    if added.rows_affected() == 0 {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "This member already holds that position",
        ));
    }
    sync_member_role(&mut tx, member_id).await?;
    log_change(&mut tx, position, member_id, &name, "assigned", actor).await?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "organization",
        operation = "assign",
        position,
        "organization.position_assigned"
    );
    Ok(json!({"ok": true}))
}

pub(crate) async fn remove_holder(
    db: &SqlitePool,
    actor: &Viewer,
    member_id: &str,
    position: &str,
) -> ApiResult<Value> {
    let mut tx = db.begin().await.map_err(internal)?;
    ensure_manages(&mut tx, actor, position).await?;
    let name = member_name(&mut tx, member_id).await?;
    leave(&mut tx, member_id, position).await?;
    log_change(&mut tx, position, member_id, &name, "removed", actor).await?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "organization",
        operation = "remove",
        position,
        "organization.position_removed"
    );
    Ok(json!({"ok": true}))
}

pub(crate) async fn resign_position(
    db: &SqlitePool,
    actor: &Viewer,
    position: &str,
) -> ApiResult<Value> {
    let mut tx = db.begin().await.map_err(internal)?;
    leave(&mut tx, &actor.id, position).await?;
    log_change(
        &mut tx,
        position,
        &actor.id,
        &actor.display_name,
        "resigned",
        actor,
    )
    .await?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "organization",
        operation = "resign",
        position,
        "organization.position_resigned"
    );
    Ok(json!({"ok": true}))
}

async fn leave(tx: &mut Tx<'_>, member_id: &str, position: &str) -> ApiResult<()> {
    let removed =
        sqlx::query("DELETE FROM member_positions WHERE member_id = ? AND position_slug = ?")
            .bind(member_id)
            .bind(position)
            .execute(&mut **tx)
            .await
            .map_err(internal)?;
    if removed.rows_affected() == 0 {
        return Err(ApiError(
            StatusCode::NOT_FOUND,
            "That member does not hold this position",
        ));
    }
    sync_member_role(tx, member_id).await
}

async fn ensure_manages(tx: &mut Tx<'_>, actor: &Viewer, position: &str) -> ApiResult<()> {
    if tree::seats_of(tx, position).await?.is_none() {
        return Err(ApiError(StatusCode::NOT_FOUND, "Unknown position"));
    }
    if tree::manages(tx, &actor.id, position).await? {
        return Ok(());
    }
    tracing::warn!(
        component = "organization",
        operation = "authorize",
        position,
        "organization.delegation_denied"
    );
    Err(ApiError(
        StatusCode::FORBIDDEN,
        "Only the holder of the position directly above can change this position",
    ))
}

async fn ensure_seat_free(tx: &mut Tx<'_>, position: &str) -> ApiResult<()> {
    if tree::seats_of(tx, position).await?.as_deref() != Some("one") {
        return Ok(());
    }
    let (holders,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM member_positions WHERE position_slug = ?")
            .bind(position)
            .fetch_one(&mut **tx)
            .await
            .map_err(internal)?;
    if holders > 0 {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "This position is already filled; remove its holder first",
        ));
    }
    Ok(())
}

async fn member_name(tx: &mut Tx<'_>, member_id: &str) -> ApiResult<String> {
    let name: Option<(String,)> = sqlx::query_as("SELECT display_name FROM members WHERE id = ?")
        .bind(member_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(internal)?;
    name.map(|(name,)| name)
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Member not found"))
}

async fn log_change(
    tx: &mut Tx<'_>,
    position: &str,
    member_id: &str,
    member_name: &str,
    action: &str,
    actor: &Viewer,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO position_assignment_log(id, position_slug, member_id, member_name, action, actor_id, actor_name, at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string())
        .bind(position)
        .bind(member_id)
        .bind(member_name)
        .bind(action)
        .bind(&actor.id)
        .bind(&actor.display_name)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}
