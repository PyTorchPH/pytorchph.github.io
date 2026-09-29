//! Membership administration: officer gates, the member list, and approving new members.
//!
//! Module map (caller-first):
//!   require_officer   viewer who must be an officer or admin
//!   list_members      GET /members (officers; admins also see pending members)
//!   approve_member    POST /members/{id}/approve (admins turn pending into member/officer)
//!   is_officer_role / is_approvable_role
use crate::{
    ApiError, ApiResult, AppState, check_origin,
    identity::session::{Viewer, viewer},
    internal,
};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberListItem {
    id: String,
    display_name: String,
    role: String,
}

#[derive(Deserialize)]
pub struct Approval {
    role: String,
}

pub async fn require_officer(state: &AppState, headers: &HeaderMap) -> ApiResult<Viewer> {
    let viewer = viewer(state, headers).await?;
    if !is_officer_role(&viewer.role) {
        return Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"));
    }
    Ok(viewer)
}

pub async fn list_members(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<MemberListItem>>> {
    let actor = require_officer(&state, &headers).await?;
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id,display_name,role FROM members WHERE role != 'pending' OR ? = 'admin' ORDER BY display_name LIMIT 500"
    ).bind(&actor.role).fetch_all(&state.db).await.map_err(internal)?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, display_name, role)| MemberListItem {
                id,
                display_name,
                role,
            })
            .collect(),
    ))
}

/// Mental model: only an admin may promote, only to member or officer, and only a member who
/// is still pending.
pub async fn approve_member(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<Approval>,
) -> ApiResult<StatusCode> {
    check_origin(&state, &headers)?;
    let actor = viewer(&state, &headers).await?;
    if actor.role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Admin access required"));
    }
    if !is_approvable_role(&payload.role) {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid approval role",
        ));
    }
    let changed = sqlx::query("UPDATE members SET role = ? WHERE id = ? AND role = 'pending'")
        .bind(&payload.role)
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(internal)?
        .rows_affected();
    if changed == 0 {
        return Err(ApiError(StatusCode::NOT_FOUND, "Pending member not found"));
    }
    tracing::info!(actor_id = %actor.id, member_id = %id, role = %payload.role, "member.approved");
    Ok(StatusCode::NO_CONTENT)
}

#[inline]
fn is_officer_role(role: &str) -> bool {
    role == "officer" || role == "admin"
}

#[inline]
fn is_approvable_role(role: &str) -> bool {
    role == "member" || role == "officer"
}
