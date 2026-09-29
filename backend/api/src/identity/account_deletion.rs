//! Leaving PyTorch PH: a member deletes their own account.
//!
//! Module map (caller-first):
//!   delete_account                DELETE /members/me
//!   ├─ ensure_confirmed           the member typed DELETE
//!   ├─ ensure_not_last_admin      the organization always keeps one admin
//!   └─ remove_member              one DELETE; foreign keys cascade everything they own
use crate::{
    ApiError, ApiResult, AppState, check_origin,
    identity::session::{Viewer, ok_with_cleared_session, viewer},
    internal,
};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::Deserialize;
use sqlx::SqlitePool;
use std::sync::Arc;

const CONFIRMATION: &str = "DELETE";

#[derive(Deserialize)]
pub struct DeleteAccount {
    confirm: String,
}

/// Mental model: a member leaving PyTorch PH deletes their account; foreign keys cascade every
/// row they own (sessions, points, claims, attendance, roles, audit, portal state).
pub async fn delete_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<DeleteAccount>,
) -> ApiResult<Response> {
    check_origin(&state, &headers)?;
    let actor = viewer(&state, &headers).await?;
    ensure_confirmed(&input)?;
    ensure_not_last_admin(&state.db, &actor).await?;
    let deleted = remove_member(&state.db, &actor).await?;
    tracing::info!(
        component = "auth",
        operation = "delete_account",
        role = %actor.role,
        deleted,
        "auth.account_deleted"
    );
    Ok(ok_with_cleared_session())
}

fn ensure_confirmed(input: &DeleteAccount) -> ApiResult<()> {
    if input.confirm != CONFIRMATION {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Type DELETE to confirm account deletion",
        ));
    }
    Ok(())
}

async fn ensure_not_last_admin(db: &SqlitePool, actor: &Viewer) -> ApiResult<()> {
    if !is_admin(actor) {
        return Ok(());
    }
    let (admins,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM members WHERE role = 'admin'")
        .fetch_one(db)
        .await
        .map_err(internal)?;
    if admins <= 1 {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Assign another admin before deleting the last admin account",
        ));
    }
    Ok(())
}

async fn remove_member(db: &SqlitePool, actor: &Viewer) -> ApiResult<u64> {
    Ok(sqlx::query("DELETE FROM members WHERE id = ?")
        .bind(&actor.id)
        .execute(db)
        .await
        .map_err(internal)?
        .rows_affected())
}

#[inline]
fn is_admin(actor: &Viewer) -> bool {
    actor.role == "admin"
}
