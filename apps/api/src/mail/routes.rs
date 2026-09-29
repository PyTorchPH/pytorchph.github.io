//! Admin setup for mail routing: which officer roles a member holds, and which roles must
//! approve (and which one sends) each recipient category.
//!
//! Module map (caller-first):
//!   set_officer_roles        POST /members/{id}/officer-roles
//!   ├─ require_approved_officer
//!   └─ replace_officer_roles roles replaced atomically, with an audit event
//!   set_route                POST /mail/routes/{category}
//!   └─ is_valid_category
use super::roles::{is_admin, is_known_role, is_valid_assignment, is_valid_role_set};
use crate::{ApiError, ApiResult, AppState, bad, check_origin, identity::session, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use sqlx::{Sqlite, Transaction};
use std::sync::Arc;
use uuid::Uuid;

const MAX_CATEGORY_LENGTH: usize = 64;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoleList {
    roles: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RouteInput {
    required_roles: Vec<String>,
    sender_role: String,
}

/// Mental model: an admin replaces a member's whole role list in one transaction, and only
/// for members who are already approved officers.
pub async fn set_officer_roles(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(member_id): Path<String>,
    Json(input): Json<RoleList>,
) -> ApiResult<StatusCode> {
    check_origin(&state, &headers)?;
    let actor = session::viewer(&state, &headers).await?;
    if !is_admin(&actor) {
        return Err(admin_required());
    }
    if !is_valid_assignment(&input.roles) {
        return Err(bad("Invalid officer roles"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    require_approved_officer(&mut tx, &member_id).await?;
    replace_officer_roles(&mut tx, &member_id, input.roles).await?;
    sqlx::query(
        "INSERT INTO audit_events(id,actor_id,operation,entity_id,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&actor.id)
    .bind("officer_roles.changed")
    .bind(&member_id)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn require_approved_officer(
    tx: &mut Transaction<'_, Sqlite>,
    member_id: &str,
) -> ApiResult<()> {
    let role: Option<(String,)> = sqlx::query_as("SELECT role FROM members WHERE id = ?")
        .bind(member_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(internal)?;
    if !matches!(
        role.as_ref().map(|row| row.0.as_str()),
        Some("officer" | "admin")
    ) {
        return Err(bad("Target must be an approved officer"));
    }
    Ok(())
}

async fn replace_officer_roles(
    tx: &mut Transaction<'_, Sqlite>,
    member_id: &str,
    roles: Vec<String>,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM officer_roles WHERE member_id = ?")
        .bind(member_id)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    for role in roles {
        sqlx::query("INSERT INTO officer_roles(member_id,role) VALUES (?,?)")
            .bind(member_id)
            .bind(role)
            .execute(&mut **tx)
            .await
            .map_err(internal)?;
    }
    Ok(())
}

pub async fn set_route(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(category): Path<String>,
    Json(input): Json<RouteInput>,
) -> ApiResult<StatusCode> {
    check_origin(&state, &headers)?;
    let actor = session::viewer(&state, &headers).await?;
    if !is_admin(&actor) {
        return Err(admin_required());
    }
    if !is_valid_category(&category)
        || !is_valid_role_set(&input.required_roles)
        || !is_known_role(&input.sender_role)
    {
        return Err(bad("Invalid mail route"));
    }
    sqlx::query("INSERT INTO mail_routes(category,required_roles_json,sender_role,updated_by,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(category) DO UPDATE SET required_roles_json=excluded.required_roles_json,sender_role=excluded.sender_role,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
        .bind(category).bind(serde_json::to_string(&input.required_roles).map_err(internal)?)
        .bind(input.sender_role).bind(&actor.id).bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db).await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

#[inline]
fn is_valid_category(category: &str) -> bool {
    !category.is_empty()
        && category.len() <= MAX_CATEGORY_LENGTH
        && category
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
}

#[inline]
fn admin_required() -> ApiError {
    ApiError(StatusCode::FORBIDDEN, "Admin access required")
}
