//! Bounded byte proxy for organization photos; the identity service owns storage and consent.
use crate::{ApiError, ApiResult, AppState, identity::session::Viewer};
use axum::{
    body::Bytes,
    http::{HeaderMap, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use std::sync::Arc;
use uuid::Uuid;

pub(super) fn is_photo_path(path: &str) -> bool {
    path == "member/organization-photo" || path.starts_with("officer/organization/photo/")
}

pub(super) async fn handle(
    state: &Arc<AppState>,
    actor: &Viewer,
    path: &str,
    method: &Method,
    headers: &HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    let identity = state.identity_client.as_deref().ok_or_else(unavailable)?;
    let viewer_id = Uuid::parse_str(&actor.id).map_err(|_| unavailable())?;
    match (method.as_str(), path) {
        ("PUT", "member/organization-photo") => {
            let media_type = headers
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
            if !matches!(media_type, "image/jpeg" | "image/png" | "image/webp")
                || body.is_empty()
                || body.len() > 384 * 1024
            {
                return Err(ApiError(StatusCode::BAD_REQUEST, "Invalid photo"));
            }
            identity
                .write_organization_photo(viewer_id, body.to_vec(), media_type)
                .await
                .map_err(|_| unavailable())?;
            Ok(no_content())
        }
        ("DELETE", "member/organization-photo") => {
            identity
                .delete_organization_photo(viewer_id)
                .await
                .map_err(|_| unavailable())?;
            Ok(no_content())
        }
        ("GET", _) if path.starts_with("officer/organization/photo/") => {
            let member_id = Uuid::parse_str(path.trim_start_matches("officer/organization/photo/"))
                .map_err(|_| ApiError(StatusCode::NOT_FOUND, "Photo unavailable"))?;
            let bytes = identity
                .organization_photo(member_id, viewer_id)
                .await
                .map_err(|_| unavailable())?;
            let Some(bytes) = bytes else {
                return Ok((
                    [(header::CACHE_CONTROL, "private, no-store")],
                    StatusCode::NOT_FOUND,
                )
                    .into_response());
            };
            Ok((
                [
                    (header::CONTENT_TYPE, "image/webp"),
                    (header::CACHE_CONTROL, "private, no-store"),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                ],
                bytes,
            )
                .into_response())
        }
        _ => Err(ApiError(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method unavailable",
        )),
    }
}

fn unavailable() -> ApiError {
    ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Identity service unavailable",
    )
}

fn no_content() -> Response {
    (
        [(header::CACHE_CONTROL, "private, no-store")],
        StatusCode::NO_CONTENT,
    )
        .into_response()
}
