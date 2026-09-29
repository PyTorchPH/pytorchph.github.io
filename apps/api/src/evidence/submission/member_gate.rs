//! Who may submit evidence: a signed-in member whose membership is approved.
//!
//! Module map:
//!   approved_member
//!   └─ is_pending
use crate::{
    ApiError, ApiResult, AppState,
    identity::session::{self, Viewer},
};
use axum::http::{HeaderMap, StatusCode};

pub(crate) async fn approved_member(state: &AppState, headers: &HeaderMap) -> ApiResult<Viewer> {
    let actor = session::viewer(state, headers).await?;
    if is_pending(&actor) {
        return Err(ApiError(StatusCode::FORBIDDEN, "Member approval required"));
    }
    Ok(actor)
}

#[inline]
fn is_pending(actor: &Viewer) -> bool {
    actor.role == "pending"
}
