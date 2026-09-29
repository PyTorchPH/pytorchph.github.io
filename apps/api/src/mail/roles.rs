//! The officer role vocabulary that mail routing is written in.
//!
//! Module map:
//!   ROLES                  every officer role a member can hold
//!   is_known_role
//!   has_no_duplicates
//!   is_valid_role_set      a non-empty, known, duplicate-free list (approval routes)
//!   is_valid_assignment    a known, duplicate-free list, possibly empty (member roles)
//!   is_admin
//!   has_role               whether a member currently holds a role
use crate::{ApiResult, AppState, identity::session::Viewer, internal};
use std::collections::HashSet;

pub(super) const ROLES: &[&str] = &[
    "ambassador",
    "secretariat",
    "treasurer",
    "external_relations",
    "academics",
    "executive",
    "campus_lead",
];

#[inline]
pub(super) fn is_known_role(role: &str) -> bool {
    ROLES.contains(&role)
}

#[inline]
pub(super) fn has_no_duplicates(items: &[String]) -> bool {
    items.iter().collect::<HashSet<_>>().len() == items.len()
}

#[inline]
pub(super) fn is_valid_role_set(roles: &[String]) -> bool {
    !roles.is_empty() && is_valid_assignment(roles)
}

#[inline]
pub(super) fn is_valid_assignment(roles: &[String]) -> bool {
    roles.len() <= ROLES.len()
        && roles.iter().all(|role| is_known_role(role))
        && has_no_duplicates(roles)
}

#[inline]
pub(super) fn is_admin(viewer: &Viewer) -> bool {
    viewer.role == "admin"
}

pub(super) async fn has_role(state: &AppState, member_id: &str, role: &str) -> ApiResult<bool> {
    let found: Option<(String,)> =
        sqlx::query_as("SELECT role FROM officer_roles WHERE member_id=? AND role=?")
            .bind(member_id)
            .bind(role)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    Ok(found.is_some())
}
