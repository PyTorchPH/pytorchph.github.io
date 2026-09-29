//! Portal state persisted in portal_state: one value per owner and view key, where the owner
//! is a member id or the organization scope.
//!
//! Module map (caller-first):
//!   current            the stored value, else the role's fixture
//!   ├─ stored          read one value
//!   └─ view_not_found
//!   save               write one value
//!   └─ encode_state    JSON text within the size cap
//!   scope              which owner a view key belongs to
use super::fixtures::fixture;
use crate::{ApiError, ApiResult, bad, internal};
use axum::http::StatusCode;
use serde_json::Value;
use sqlx::SqlitePool;

pub(crate) const ORG: &str = "__organization__";
const MAX_STATE_BYTES: usize = 262_144;

pub(crate) async fn current(
    db: &SqlitePool,
    role: &str,
    owner: &str,
    key: &str,
) -> ApiResult<Value> {
    if let Some(value) = stored(db, owner, key).await? {
        return Ok(value);
    }
    fixture(role, key)
        .map(|(_, body)| body)
        .ok_or_else(view_not_found)
}

pub(crate) async fn stored(db: &SqlitePool, owner: &str, key: &str) -> ApiResult<Option<Value>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value_json FROM portal_state WHERE scope=? AND state_key=?")
            .bind(owner)
            .bind(key)
            .fetch_optional(db)
            .await
            .map_err(internal)?;
    row.map(|item| serde_json::from_str(&item.0).map_err(internal))
        .transpose()
}

#[inline]
pub(crate) fn view_not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "Product view not found")
}

pub(crate) async fn save(db: &SqlitePool, owner: &str, key: &str, value: &Value) -> ApiResult<()> {
    let encoded = encode_state(value)?;
    sqlx::query("INSERT INTO portal_state(scope,state_key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(scope,state_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
        .bind(owner).bind(key).bind(encoded).bind(chrono::Utc::now().to_rfc3339())
        .execute(db).await.map_err(internal)?;
    Ok(())
}

fn encode_state(value: &Value) -> ApiResult<String> {
    let encoded = serde_json::to_string(value).map_err(internal)?;
    if encoded.len() > MAX_STATE_BYTES {
        return Err(bad("Product state is too large"));
    }
    Ok(encoded)
}

// Feedback and officer views are shared by the organization; everything else is the member's.
pub(crate) fn scope<'a>(member_id: &'a str, key: &str) -> &'a str {
    if key == "/api/feedback"
        || key.starts_with("/api/feedback/")
        || key.starts_with("/api/officer/")
    {
        ORG
    } else {
        member_id
    }
}
