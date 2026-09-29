//! Demo buttons on product views: advance an opportunity, toggle an event registration,
//! approve a human review.
//!
//! Module map (caller-first):
//!   demo_action
//!   ├─ view_key_for             which saved view the action edits
//!   ├─ DemoAction::parse        action name → action (unknown names are rejected)
//!   ├─ find_record              the record with the requested id in that view's list
//!   └─ DemoAction::apply        the one field each action changes
//!       └─ next_stage
use crate::portal::{
    fields::{field, limited},
    is_officer,
    store::{current, save},
};
use crate::{ApiError, ApiResult, bad};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::SqlitePool;

const OPPORTUNITY_STAGES: [&str; 4] = ["discovered", "drafted", "human_review", "demo_confirmed"];

#[derive(Clone, Copy, PartialEq, Eq)]
enum DemoAction {
    AdvanceOpportunity,
    ToggleEvent,
    ApproveReview,
}

// Mental model: load the view the action belongs to, find the record by id, change one field,
// and save the view back.
pub(crate) async fn demo_action(
    db: &SqlitePool,
    member_id: &str,
    role: &str,
    input: Value,
) -> ApiResult<Value> {
    let action_name = field(&input, "action")?;
    let id = field(&input, "id")?;
    if !limited(id, 120) {
        return Err(bad("Invalid record ID"));
    }
    let view_key = view_key_for(action_name);
    let mut view = current(db, role, member_id, view_key).await?;
    let action = DemoAction::parse(action_name)?;
    if action == DemoAction::ApproveReview && !is_officer(role) {
        return Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"));
    }
    action.apply(find_record(&mut view, action, id)?);
    save(db, member_id, view_key, &view).await?;
    Ok(json!({"ok":true,"state":{"updatedId":id,"action":action_name}}))
}

#[inline]
fn view_key_for(action_name: &str) -> &'static str {
    if action_name == "approve_review" {
        "/api/product/job-operations"
    } else {
        "/api/product/dashboard"
    }
}

impl DemoAction {
    fn parse(name: &str) -> ApiResult<Self> {
        match name {
            "advance_opportunity" => Ok(Self::AdvanceOpportunity),
            "toggle_event" => Ok(Self::ToggleEvent),
            "approve_review" => Ok(Self::ApproveReview),
            _ => Err(bad("Unsupported product action")),
        }
    }

    fn apply(self, item: &mut Value) {
        match self {
            Self::AdvanceOpportunity => {
                let stage = item
                    .get("stage")
                    .and_then(Value::as_str)
                    .unwrap_or("discovered");
                item["stage"] = json!(next_stage(stage));
            }
            Self::ToggleEvent => {
                let registered = item
                    .get("registered")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                item["registered"] = json!(!registered);
            }
            Self::ApproveReview => item["approved"] = json!(true),
        }
    }
}

fn find_record<'a>(view: &'a mut Value, action: DemoAction, id: &str) -> ApiResult<&'a mut Value> {
    let items = match action {
        DemoAction::ApproveReview => view.pointer_mut("/operations/reviews"),
        DemoAction::AdvanceOpportunity => view.get_mut("opportunities"),
        DemoAction::ToggleEvent => view.get_mut("events"),
    };
    items
        .and_then(Value::as_array_mut)
        .ok_or_else(|| bad("Product records unavailable"))?
        .iter_mut()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(id))
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Product record not found"))
}

/// The following stage, capped at the last one; unknown stages restart at "drafted".
#[inline]
fn next_stage(stage: &str) -> &'static str {
    OPPORTUNITY_STAGES
        .iter()
        .position(|value| *value == stage)
        .map(|index| OPPORTUNITY_STAGES[(index + 1).min(OPPORTUNITY_STAGES.len() - 1)])
        .unwrap_or("drafted")
}
