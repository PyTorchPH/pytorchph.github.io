//! Evidence photos served back only to the member who uploaded them.
//!
//! Module map (caller-first):
//!   media                   GET /portal/media/{id}
//!   ├─ load_owned_photo     the bytes, only when the viewer owns them
//!   └─ jpeg_response        private, no-sniff JPEG response
use crate::{ApiError, ApiResult, AppState, identity::session, internal};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use sqlx::SqlitePool;
use std::sync::Arc;
use uuid::Uuid;

// Mental model: a signed-in member asks for a photo id; it is found only among their own
// uploads, so another member's id reads as "not found".
pub async fn media(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let actor = session::viewer(&state, &headers).await?;
    if Uuid::parse_str(&id).is_err() {
        return Err(media_not_found());
    }
    let bytes = load_owned_photo(&state.db, &id, &actor.id).await?;
    Ok(jpeg_response(bytes))
}

async fn load_owned_photo(db: &SqlitePool, id: &str, owner_id: &str) -> ApiResult<Vec<u8>> {
    let row: Option<(Vec<u8>,)> =
        sqlx::query_as("SELECT bytes FROM portal_media WHERE id=? AND owner_id=?")
            .bind(id)
            .bind(owner_id)
            .fetch_optional(db)
            .await
            .map_err(internal)?;
    Ok(row.ok_or_else(media_not_found)?.0)
}

#[inline]
fn media_not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "Media not found")
}

fn jpeg_response(bytes: Vec<u8>) -> Response {
    (
        [
            ("content-type", "image/jpeg"),
            ("cache-control", "private, no-store"),
            ("x-content-type-options", "nosniff"),
        ],
        bytes,
    )
        .into_response()
}
