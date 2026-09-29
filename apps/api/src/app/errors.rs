//! The API error type and the checks every handler shares.
use crate::AppState;
use axum::{
    Json,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use tracing::error;

#[derive(Debug)]
pub(crate) struct ApiError(pub(crate) StatusCode, pub(crate) &'static str);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({"error": self.1}))).into_response()
    }
}

pub(crate) type ApiResult<T> = Result<T, ApiError>;

pub(crate) fn internal(error: impl std::fmt::Display) -> ApiError {
    error!(error = %error, "api.internal_error");
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, "Internal error")
}

pub(crate) fn bad(message: &'static str) -> ApiError {
    ApiError(StatusCode::UNPROCESSABLE_ENTITY, message)
}

pub(crate) fn check_origin(state: &AppState, headers: &HeaderMap) -> ApiResult<()> {
    if headers.get("origin").and_then(|v| v.to_str().ok()) == Some(state.allowed_origin.as_str()) {
        Ok(())
    } else {
        Err(ApiError(StatusCode::FORBIDDEN, "Invalid origin"))
    }
}
