use crate::{ApiError, ApiResult, AppState, internal};
use axum::{Json, extract::State, http::StatusCode};
use serde_json::Value;
use sqlx::SqlitePool;
use std::sync::Arc;
use tracing::info;

const SEED: &str = include_str!("../seeds/demo-fixtures.json");

pub async fn seed(db: &SqlitePool) -> Result<(), sqlx::Error> {
    let result =
        sqlx::query("INSERT OR IGNORE INTO demo_fixtures (id, payload_json) VALUES (1, ?)")
            .bind(SEED)
            .execute(db)
            .await?;
    info!(
        event = "api.demo.seed",
        inserted = result.rows_affected(),
        "demo fixture seed completed"
    );
    Ok(())
}

pub async fn fixtures(State(state): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    let payload: Option<String> =
        sqlx::query_scalar("SELECT payload_json FROM demo_fixtures WHERE id = 1")
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    let payload = payload.ok_or(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Demo data unavailable",
    ))?;
    let value = serde_json::from_str(&payload).map_err(internal)?;
    Ok(Json(value))
}
