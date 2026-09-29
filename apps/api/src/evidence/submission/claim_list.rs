//! GET /evidence/me (a member's own claims) and GET /evidence/pending (officer queue).
//!
//! Module map (caller-first):
//!   my_claims          newest first, up to 100
//!   pending_claims     officers only, oldest first, up to 100
//!   └─ claims          one query per audience
//!      └─ claim_view   one row as ClaimView
use crate::{ApiResult, AppState, identity::session, internal};
use axum::{Json, extract::State, http::HeaderMap};
use serde::Serialize;
use sqlx::{Row, sqlite::SqliteRow};
use std::sync::Arc;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimView {
    id: String,
    member_id: String,
    kind: String,
    title: String,
    source_url: String,
    source: String,
    origin: String,
    submitted_text: Option<String>,
    status: String,
    points: Option<i64>,
}

pub async fn my_claims(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<ClaimView>>> {
    let actor = session::viewer(&state, &headers).await?;
    Ok(Json(claims(&state, Some(&actor.id)).await?))
}

pub async fn pending_claims(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<ClaimView>>> {
    let _ = session::require_officer(&state, &headers).await?;
    Ok(Json(claims(&state, None).await?))
}

/// A member's own claims when `owner` is set, otherwise every pending claim.
async fn claims(state: &AppState, owner: Option<&str>) -> ApiResult<Vec<ClaimView>> {
    let rows = if let Some(owner) = owner {
        sqlx::query("SELECT id,member_id,kind,title,source_url,source,origin,submitted_text,status,points FROM evidence_claims WHERE member_id=? ORDER BY created_at DESC LIMIT 100")
            .bind(owner).fetch_all(&state.db).await.map_err(internal)?
    } else {
        sqlx::query("SELECT id,member_id,kind,title,source_url,source,origin,submitted_text,status,points FROM evidence_claims WHERE status='pending' ORDER BY created_at LIMIT 100")
            .fetch_all(&state.db).await.map_err(internal)?
    };
    Ok(rows.iter().map(claim_view).collect())
}

fn claim_view(row: &SqliteRow) -> ClaimView {
    ClaimView {
        id: row.get(0),
        member_id: row.get(1),
        kind: row.get(2),
        title: row.get(3),
        source_url: row.get(4),
        source: row.get(5),
        origin: row.get(6),
        submitted_text: row.get(7),
        status: row.get(8),
        points: row.get(9),
    }
}
