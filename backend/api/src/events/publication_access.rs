//! Current position grants own event publication authority; account role is only admission.
use crate::{ApiError, ApiResult, identity::session::Viewer, internal};
use axum::http::StatusCode;
use serde::Serialize;
use sqlx::{FromRow, Sqlite, Transaction};

#[derive(FromRow)]
struct Grant {
    can_create: bool,
    can_edit_owned_draft: bool,
    can_edit_public_content: bool,
    can_manage: bool,
    can_publish: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Permissions {
    pub can_create: bool,
    pub can_edit: bool,
    pub can_publish: bool,
    pub can_change_flags: bool,
}

pub(super) async fn permissions(
    tx: &mut Transaction<'_, Sqlite>,
    actor: &Viewer,
    owner: &str,
    is_public: bool,
) -> ApiResult<Permissions> {
    let grants: Vec<Grant> = sqlx::query_as(
        "SELECT g.can_create,g.can_edit_owned_draft,g.can_edit_public_content,g.can_manage,g.can_publish FROM event_position_grants g JOIN member_positions p ON p.position_slug=g.position_slug JOIN members m ON m.id=p.member_id WHERE p.member_id=? AND m.role IN ('officer','admin')"
    ).bind(&actor.id).fetch_all(&mut **tx).await.map_err(internal)?;
    let can_publish = grants.iter().any(|grant| grant.can_publish);
    let manage = grants.iter().any(|grant| grant.can_manage);
    let owned_draft =
        !is_public && owner == actor.id && grants.iter().any(|grant| grant.can_edit_owned_draft);
    let public_content = is_public && grants.iter().any(|grant| grant.can_edit_public_content);
    Ok(Permissions {
        can_create: grants.iter().any(|grant| grant.can_create),
        can_edit: manage || owned_draft || public_content,
        can_publish,
        can_change_flags: can_publish && manage,
    })
}

pub(super) async fn require_create(
    tx: &mut Transaction<'_, Sqlite>,
    actor: &Viewer,
    is_public: bool,
) -> ApiResult<()> {
    let permissions = permissions(tx, actor, &actor.id, false).await?;
    require_allowed(
        permissions.can_create && (!is_public || permissions.can_publish),
        "create",
    )
}

pub(super) async fn require_update(
    tx: &mut Transaction<'_, Sqlite>,
    actor: &Viewer,
    owner: &str,
    was_public: bool,
    was_demo: bool,
    is_public: bool,
    is_demo: bool,
) -> ApiResult<()> {
    let permissions = permissions(tx, actor, owner, was_public).await?;
    let flags_unchanged = was_public == is_public && was_demo == is_demo;
    require_allowed(
        permissions.can_edit && (flags_unchanged || permissions.can_change_flags),
        "publication_update",
    )
}

fn require_allowed(allowed: bool, operation: &'static str) -> ApiResult<()> {
    tracing::info!(
        component = "events",
        operation,
        allowed,
        event = "events.position_authority_decided"
    );
    if allowed {
        Ok(())
    } else {
        Err(ApiError(
            StatusCode::FORBIDDEN,
            "Current position does not permit this event action",
        ))
    }
}
