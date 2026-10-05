//! Assignment-derived authority decisions for organization-scoped resources.
//!
//! A decision proves one continuous path from a position the actor currently holds to the
//! position that owns the resource. Separate assignments are never combined into one decision.
use super::tree;
use crate::{ApiResult, identity::session::Viewer};
use serde::Serialize;
use sqlx::{Sqlite, Transaction};
use std::collections::HashSet;
use uuid::Uuid;

type Tx<'a> = Transaction<'a, Sqlite>;

const MAX_HIERARCHY_DEPTH: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthorityDecision {
    pub(crate) decision_id: String,
    pub(crate) allowed: bool,
    pub(crate) actor_member_id: String,
    pub(crate) acting_position: String,
    pub(crate) resource_scope: String,
    pub(crate) hierarchy_path: Vec<String>,
    pub(crate) reason: &'static str,
}

// Mental model: prove that the actor holds exactly the position they claim, then walk one rooted
// hierarchy path from that position to the resource owner. Any missing proof is an explicit denial.
pub(crate) async fn resolve_position_authority(
    tx: &mut Tx<'_>,
    actor: &Viewer,
    acting_position: &str,
    resource_scope: &str,
) -> ApiResult<AuthorityDecision> {
    let decision_id = Uuid::new_v4().to_string();

    let decision = if !tree::holds(tx, &actor.id, acting_position).await? {
        denied_decision(
            decision_id,
            actor,
            acting_position,
            resource_scope,
            "actor_does_not_hold_acting_position",
        )
    } else if let Some(hierarchy_path) = authority_path(tx, acting_position, resource_scope).await?
    {
        allowed_decision(
            decision_id,
            actor,
            acting_position,
            resource_scope,
            hierarchy_path,
        )
    } else {
        denied_decision(
            decision_id,
            actor,
            acting_position,
            resource_scope,
            "no_single_authority_path",
        )
    };

    record_decision(&decision);
    Ok(decision)
}

async fn authority_path(
    tx: &mut Tx<'_>,
    acting_position: &str,
    resource_scope: &str,
) -> ApiResult<Option<Vec<String>>> {
    if acting_position == resource_scope {
        return Ok(Some(vec![acting_position.to_owned()]));
    }

    let mut reverse_path = vec![resource_scope.to_owned()];
    let mut visited = HashSet::from([resource_scope.to_owned()]);
    let mut current = resource_scope.to_owned();

    for _ in 0..MAX_HIERARCHY_DEPTH {
        let Some(parent) = tree::parent_of(tx, &current).await? else {
            return Ok(None);
        };
        if !visited.insert(parent.clone()) {
            return Ok(None);
        }
        reverse_path.push(parent.clone());
        if parent == acting_position {
            reverse_path.reverse();
            return Ok(Some(reverse_path));
        }
        current = parent;
    }

    Ok(None)
}

fn allowed_decision(
    decision_id: String,
    actor: &Viewer,
    acting_position: &str,
    resource_scope: &str,
    hierarchy_path: Vec<String>,
) -> AuthorityDecision {
    AuthorityDecision {
        decision_id,
        allowed: true,
        actor_member_id: actor.id.clone(),
        acting_position: acting_position.to_owned(),
        resource_scope: resource_scope.to_owned(),
        hierarchy_path,
        reason: "continuous_authority_path",
    }
}

fn denied_decision(
    decision_id: String,
    actor: &Viewer,
    acting_position: &str,
    resource_scope: &str,
    reason: &'static str,
) -> AuthorityDecision {
    AuthorityDecision {
        decision_id,
        allowed: false,
        actor_member_id: actor.id.clone(),
        acting_position: acting_position.to_owned(),
        resource_scope: resource_scope.to_owned(),
        hierarchy_path: Vec::new(),
        reason,
    }
}

fn record_decision(decision: &AuthorityDecision) {
    tracing::info!(
        event = "organization.authorization.decided",
        decision_id = %decision.decision_id,
        actor_member_id = %decision.actor_member_id,
        acting_position = %decision.acting_position,
        resource_scope = %decision.resource_scope,
        allowed = decision.allowed,
        reason = decision.reason,
        hierarchy_path_length = decision.hierarchy_path.len(),
        "organization authority resolved"
    );
}
