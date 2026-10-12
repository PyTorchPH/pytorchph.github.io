//! Officer-edited website content; public reads receive only the published revision.
pub(crate) mod model;
mod official_news;
mod programs;
pub(crate) mod store;
use crate::{ApiResult, AppState};
use axum::{Json, extract::State};
use serde_json::Value;
use std::sync::Arc;

pub(crate) async fn public_content(State(state): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    let mut bundle = store::published(&state.db).await?;
    let news = official_news::load(&state).await;
    bundle["schemaVersion"] = Value::from(2);
    bundle["officialPytorchNews"] = news["items"].clone();
    bundle["sources"] = serde_json::json!({"officialPytorchNews": news["source"]});
    Ok(Json(bundle))
}
