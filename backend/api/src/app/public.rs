//! Unauthenticated reads: health, the public points table and published events.
use crate::{ApiResult, AppState, http::admission, internal};
use axum::{Json, extract::State, http::HeaderValue, response::IntoResponse};
use std::sync::Arc;

pub(crate) async fn health(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let mut body = admission::health_figures(&state.db).await;
    body["status"] = serde_json::json!("ok");
    Json(body)
}

// Mental model: rank the cached totals with ties sharing a rank (1, 1, 3), cacheable for 30 s.
pub(crate) async fn public_leaderboard(
    State(state): State<Arc<AppState>>,
) -> ApiResult<impl IntoResponse> {
    let body = crate::leaderboard::public_verified(&state.db).await?;
    let mut response = Json(body).into_response();
    response.headers_mut().insert(
        "cache-control",
        HeaderValue::from_static("public, max-age=30"),
    );
    Ok(response)
}

/// id, title, category, starts_at, parent_id, published_at.
type PublicEventRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
);

pub(crate) async fn public_events(
    State(state): State<Arc<AppState>>,
) -> ApiResult<impl IntoResponse> {
    let rows: Vec<PublicEventRow> = sqlx::query_as(
        "SELECT id,title,category,starts_at,parent_id,published_at FROM events ORDER BY starts_at DESC LIMIT 100"
    ).fetch_all(&state.db).await.map_err(internal)?;
    let body: Vec<_> = rows.into_iter().map(|(id,title,category,starts_at,parent_id,published_at)| {
        serde_json::json!({"id": id, "title": title, "category": category, "startsAt": starts_at, "parentId": parent_id, "publishedAt": published_at})
    }).collect();
    Ok(Json(body))
}
