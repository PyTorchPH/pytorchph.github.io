//! POST /evidence/extension: items the browser extension collected from one GitHub, LinkedIn
//! or Facebook page, submitted by the member for officer review.
//!
//! Module map (caller-first):
//!   submit_extension
//!   ├─ member_gate::approved_member
//!   ├─ ensure_valid_envelope        schema, origin, item count, content hash, https page on the source's host
//!   │   ├─ is_sha256_tagged
//!   │   └─ is_https_on_source
//!   │       └─ source_host_matches
//!   ├─ submit_item                  per item, inside one transaction
//!   │   ├─ ensure_valid_item
//!   │   ├─ extension_kind           extension item kind → claim kind
//!   │   ├─ item_content_hash        canonical JSON of (source, kind, url, title, text)
//!   │   └─ insert_extension_claim   duplicates of an earlier submission are skipped
//!   └─ SubmissionTally              submitted vs duplicate counts
use super::member_gate::approved_member;
use crate::{ApiResult, AppState, bad, check_origin, internal};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::SqliteConnection;
use std::sync::Arc;
use url::Url;
use uuid::Uuid;

const ENVELOPE_SCHEMA_VERSION: i64 = 1;
const EXTENSION_ORIGIN: &str = "extension_scrape";
const MAX_ITEMS: usize = 50;
const TAGGED_SHA256_LEN: usize = 71;
const SHA256_TAG: &str = "sha256:";
const MIN_TITLE_CHARS: usize = 3;
const MAX_TITLE_BYTES: usize = 200;
const MAX_URL_BYTES: usize = 2048;
const MAX_TEXT_BYTES: usize = 5000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionEnvelope {
    schema_version: i64,
    source: String,
    origin: String,
    page_url: String,
    content_hash: String,
    items: Vec<ExtensionItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionItem {
    title: String,
    text: String,
    source_url: String,
    evidence_kind: String,
}

#[derive(Default)]
struct SubmissionTally {
    submitted: i64,
    duplicates: i64,
}

impl SubmissionTally {
    #[inline]
    fn record(&mut self, inserted: bool) {
        if inserted {
            self.submitted += 1;
        } else {
            self.duplicates += 1;
        }
    }
}

// Mental model: check who is sending and that the envelope really came from the source's own
// page; then store every item as a pending claim in one transaction, counting items that were
// already submitted as duplicates instead of failing.
pub async fn submit_extension(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ExtensionEnvelope>,
) -> ApiResult<(StatusCode, Json<serde_json::Value>)> {
    check_origin(&state, &headers)?;
    let actor = approved_member(&state, &headers).await?;
    ensure_valid_envelope(&input)?;
    let mut tx = state.db.begin().await.map_err(internal)?;
    let mut tally = SubmissionTally::default();
    for item in &input.items {
        let inserted = submit_item(&mut tx, &actor.id, &input.source, item).await?;
        tally.record(inserted);
    }
    tx.commit().await.map_err(internal)?;
    tracing::info!(member_id = %actor.id, submitted = tally.submitted, duplicates = tally.duplicates, "evidence.extension_submitted");
    Ok((
        StatusCode::CREATED,
        Json(
            serde_json::json!({"submitted": tally.submitted, "duplicates": tally.duplicates, "status": "pending"}),
        ),
    ))
}

fn ensure_valid_envelope(input: &ExtensionEnvelope) -> ApiResult<()> {
    let page = Url::parse(&input.page_url).map_err(|_| bad("Invalid extension page"))?;
    let valid = input.schema_version == ENVELOPE_SCHEMA_VERSION
        && input.origin == EXTENSION_ORIGIN
        && has_item_count_in_range(input)
        && is_sha256_tagged(&input.content_hash)
        && is_https_on_source(&page, &input.source);
    if valid {
        Ok(())
    } else {
        Err(bad("Invalid extension envelope"))
    }
}

#[inline]
fn has_item_count_in_range(input: &ExtensionEnvelope) -> bool {
    !input.items.is_empty() && input.items.len() <= MAX_ITEMS
}

#[inline]
fn is_sha256_tagged(hash: &str) -> bool {
    hash.len() == TAGGED_SHA256_LEN
        && hash.starts_with(SHA256_TAG)
        && hash[SHA256_TAG.len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
}

#[inline]
fn is_https_on_source(url: &Url, source: &str) -> bool {
    url.scheme() == "https"
        && url
            .host_str()
            .is_some_and(|host| source_host_matches(source, host))
}

fn source_host_matches(source: &str, host: &str) -> bool {
    match source {
        "github" => host == "github.com",
        "facebook" => host == "facebook.com" || host.ends_with(".facebook.com"),
        "linkedin" => host == "linkedin.com" || host.ends_with(".linkedin.com"),
        _ => false,
    }
}

/// Returns whether the item became a new claim (false for a duplicate).
async fn submit_item(
    conn: &mut SqliteConnection,
    member_id: &str,
    source: &str,
    item: &ExtensionItem,
) -> ApiResult<bool> {
    let source_url = ensure_valid_item(item, source)?;
    let kind = extension_kind(&item.evidence_kind, source);
    let hash = item_content_hash(source, kind, &source_url, item)?;
    insert_extension_claim(conn, member_id, source, kind, &source_url, item, hash).await
}

fn ensure_valid_item(item: &ExtensionItem, source: &str) -> ApiResult<Url> {
    let source_url = Url::parse(&item.source_url).map_err(|_| bad("Invalid evidence URL"))?;
    let valid = is_valid_title(&item.title)
        && item.source_url.len() <= MAX_URL_BYTES
        && is_valid_text(&item.text)
        && is_https_on_source(&source_url, source)
        && is_known_item_kind(&item.evidence_kind);
    if valid {
        Ok(source_url)
    } else {
        Err(bad("Invalid extension evidence item"))
    }
}

#[inline]
fn is_valid_title(title: &str) -> bool {
    title.trim().len() >= MIN_TITLE_CHARS && title.len() <= MAX_TITLE_BYTES
}

#[inline]
fn is_valid_text(text: &str) -> bool {
    !text.trim().is_empty() && text.len() <= MAX_TEXT_BYTES
}

#[inline]
fn is_known_item_kind(kind: &str) -> bool {
    matches!(kind, "project" | "achievement" | "competition" | "activity")
}

fn extension_kind(kind: &str, source: &str) -> &'static str {
    match (kind, source) {
        ("project", "github") => "personal_project",
        ("competition", _) => "external_competition",
        ("activity" | "achievement", _) => "external_participation",
        _ => "external_participation",
    }
}

fn item_content_hash(
    source: &str,
    kind: &str,
    source_url: &Url,
    item: &ExtensionItem,
) -> ApiResult<String> {
    let canonical =
        serde_json::to_vec(&(source, kind, source_url.as_str(), &item.title, &item.text))
            .map_err(internal)?;
    Ok(hex::encode(Sha256::digest(canonical)))
}

async fn insert_extension_claim(
    conn: &mut SqliteConnection,
    member_id: &str,
    source: &str,
    kind: &str,
    source_url: &Url,
    item: &ExtensionItem,
    hash: String,
) -> ApiResult<bool> {
    let changed = sqlx::query("INSERT INTO evidence_claims(id,member_id,kind,title,source_url,source,origin,submitted_text,content_hash,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?) ON CONFLICT(member_id,content_hash) DO NOTHING")
        .bind(Uuid::new_v4().to_string()).bind(member_id).bind(kind).bind(item.title.trim())
        .bind(source_url.as_str()).bind(source).bind(EXTENSION_ORIGIN).bind(&item.text)
        .bind(hash).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *conn).await.map_err(internal)?.rows_affected();
    Ok(changed == 1)
}
