//! Officer-edited website content; public reads receive only the published revision.
pub(crate) mod model;
pub(crate) mod store;
use crate::{ApiResult, AppState};
use axum::{Json, extract::State};
use serde_json::Value;
use std::sync::Arc;

pub(crate) async fn public_content(State(state): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    Ok(Json(store::published(&state.db).await?))
}
