//! Officer-edited website content; public reads receive only the published revision.
pub(crate) mod campus;
pub(crate) mod directory;
pub(crate) mod model;
mod official_news;
pub(crate) mod programs;
pub(crate) mod store;
use crate::{ApiResult, AppState};
use axum::{
    Json,
    extract::State,
    http::header,
    response::{IntoResponse, Response},
};
use std::sync::Arc;

pub(crate) async fn public_content(State(state): State<Arc<AppState>>) -> ApiResult<Response> {
    let mut bundle = store::published(&state.db).await?;
    let (directory, news) = tokio::join!(directory::project(&state), official_news::load(&state));
    let (leadership, chapters) = directory?;
    bundle["document"]["leadership"] = serde_json::json!(leadership);
    bundle["document"]["chapters"] = serde_json::json!(chapters);
    bundle["document"]["events"] = serde_json::json!(programs::canonical_public(&state.db).await?);
    bundle["schemaVersion"] = serde_json::Value::from(4);
    bundle["officialPytorchNews"] = news["items"].clone();
    bundle["sources"] = serde_json::json!({"officialPytorchNews": news["source"]});
    let mut response = Json(bundle).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "private, no-store".parse().unwrap());
    Ok(response)
}
