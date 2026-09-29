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
    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT m.id, m.public_handle, c.points FROM leaderboard_cache c JOIN members m ON m.id = c.member_id WHERE m.role != 'pending' ORDER BY c.points DESC, m.id ASC LIMIT 100"
    ).fetch_all(&state.db).await.map_err(internal)?;
    let mut prior_points = None;
    let mut peer_rank = 0;
    let body: Vec<_> = rows.into_iter().enumerate().map(|(i, (member_id, display_name, points))| {
        if prior_points != Some(points) { peer_rank = i + 1; }
        prior_points = Some(points);
        serde_json::json!({"rank": peer_rank, "memberId": member_id, "displayName": display_name, "points": points})
    }).collect();
    let mut response = Json(body).into_response();
    response.headers_mut().insert(
        "cache-control",
        HeaderValue::from_static("public, max-age=30"),
    );
    Ok(response)
}

pub(crate) async fn public_events(
    State(state): State<Arc<AppState>>,
) -> ApiResult<impl IntoResponse> {
    let rows: Vec<(String, String, String, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id,title,category,starts_at,parent_id,published_at FROM events ORDER BY starts_at DESC LIMIT 100"
    ).fetch_all(&state.db).await.map_err(internal)?;
    let body: Vec<_> = rows.into_iter().map(|(id,title,category,starts_at,parent_id,published_at)| {
        serde_json::json!({"id": id, "title": title, "category": category, "startsAt": starts_at, "parentId": parent_id, "publishedAt": published_at})
    }).collect();
    Ok(Json(body))
}
