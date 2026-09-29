//! POST /evidence: a member submits one claim with a public source URL and its content hash.
//!
//! Module map (caller-first):
//!   submit_claim
//!   ├─ member_gate::approved_member
//!   ├─ is_acceptable_claim
//!   │   ├─ is_known_kind
//!   │   ├─ is_valid_title
//!   │   ├─ is_web_url
//!   │   └─ is_sha256_hex
//!   └─ insert_claim           a duplicate hash reads as "already submitted"
use super::member_gate::approved_member;
use crate::{ApiResult, AppState, bad, check_origin, internal};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use url::Url;
use uuid::Uuid;

const MIN_TITLE_CHARS: usize = 3;
const MAX_TITLE_BYTES: usize = 200;
const MAX_URL_BYTES: usize = 2048;
const SHA256_HEX_LEN: usize = 64;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewClaim {
    kind: String,
    title: String,
    source_url: String,
    content_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRef {
    id: String,
    status: &'static str,
}

// Mental model: only approved members, same-origin, with a well-formed claim; the unique
// (member, content hash) index turns a repeat into "Evidence already submitted".
pub async fn submit_claim(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<NewClaim>,
) -> ApiResult<(StatusCode, Json<ClaimRef>)> {
    check_origin(&state, &headers)?;
    let actor = approved_member(&state, &headers).await?;
    let url = Url::parse(&input.source_url).map_err(|_| bad("Invalid evidence URL"))?;
    if !is_acceptable_claim(&input, &url) {
        return Err(bad("Invalid evidence claim"));
    }
    let id = insert_claim(&state, &actor.id, &input).await?;
    Ok((
        StatusCode::CREATED,
        Json(ClaimRef {
            id,
            status: "pending",
        }),
    ))
}

fn is_acceptable_claim(input: &NewClaim, url: &Url) -> bool {
    is_known_kind(&input.kind)
        && is_valid_title(&input.title)
        && input.source_url.len() <= MAX_URL_BYTES
        && is_web_url(url)
        && is_sha256_hex(&input.content_hash)
}

#[inline]
fn is_known_kind(kind: &str) -> bool {
    matches!(
        kind,
        "personal_project" | "external_talk" | "external_competition" | "external_participation"
    )
}

#[inline]
fn is_valid_title(title: &str) -> bool {
    title.trim().len() >= MIN_TITLE_CHARS && title.len() <= MAX_TITLE_BYTES
}

#[inline]
fn is_web_url(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "http") && url.host_str().is_some()
}

#[inline]
fn is_sha256_hex(hash: &str) -> bool {
    hash.len() == SHA256_HEX_LEN && hash.bytes().all(|value| value.is_ascii_hexdigit())
}

async fn insert_claim(state: &AppState, member_id: &str, input: &NewClaim) -> ApiResult<String> {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO evidence_claims(id,member_id,kind,title,source_url,content_hash,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)")
        .bind(&id).bind(member_id).bind(&input.kind).bind(input.title.trim()).bind(&input.source_url)
        .bind(input.content_hash.to_ascii_lowercase()).bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db).await.map_err(|error| {
            if error.as_database_error().is_some_and(|db| db.is_unique_violation()) { bad("Evidence already submitted") } else { internal(error) }
        })?;
    Ok(id)
}
