//! Bug report attachments: recent console logs, a sanitized page-state snapshot, and an
//! extension screenshot. Stored once per report and kind; visible to officers and the reporter.
//!
//! Module map (caller-first):
//!   add_attachment              the reporter attaches one item per kind to their own report
//!   ├─ reporter_of              who filed the report
//!   ├─ decode_attachment        request data → (mime, bytes) for its kind
//!   │   ├─ AttachmentKind::parse
//!   │   ├─ decode_screenshot    JPEG/PNG data URL → bytes
//!   │   ├─ page_state_bytes
//!   │   └─ encode_logs          strictly shaped log entries → JSON bytes
//!   │       └─ is_valid_log_entry
//!   ├─ ensure_storable_size
//!   └─ store_attachment         one row per (report, kind), replaced on re-upload
//!   attachments                 contents for the report detail view
//!   ├─ reporter_of
//!   ├─ may_read_attachments     reporter or officer
//!   └─ attachment_json
//!       └─ attachment_content   screenshot data URL · parsed logs · page-state text
//!   attachment_kinds            kinds present per report, for list badges
use crate::{ApiError, ApiResult, bad, identity::session::Viewer, internal, portal::feedback_rows};
use axum::http::StatusCode;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use std::collections::HashMap;

const MAX_BYTES: usize = 262_144;
const MAX_LOG_ENTRIES: usize = 100;
const MAX_LOG_MESSAGE: usize = 500;
const MAX_LOG_TIMESTAMP_BYTES: usize = 40;
const LOG_ENTRY_FIELDS: usize = 3;
const JPEG_DATA_URL_PREFIX: &str = "data:image/jpeg;base64,";
const PNG_DATA_URL_PREFIX: &str = "data:image/png;base64,";

#[derive(Clone, Copy)]
enum AttachmentKind {
    Screenshot,
    PageState,
    Logs,
}

impl AttachmentKind {
    fn parse(kind: &str) -> Option<Self> {
        match kind {
            "screenshot" => Some(Self::Screenshot),
            "page_state" => Some(Self::PageState),
            "logs" => Some(Self::Logs),
            _ => None,
        }
    }
}

#[inline]
fn is_officer(role: &str) -> bool {
    role == "officer" || role == "admin"
}

async fn reporter_of(db: &SqlitePool, feedback_id: &str) -> ApiResult<String> {
    feedback_rows(db)
        .await?
        .iter()
        .find(|row| row.get("id").and_then(Value::as_str) == Some(feedback_id))
        .and_then(|row| {
            row.get("reporterId")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Report not found"))
}

/// The reporter attaches one item per kind to their own report.
// Mental model: only the reporter may attach; each kind has its own decoder and size cap, and
// a new upload of the same kind replaces the previous one.
pub(crate) async fn add_attachment(
    db: &SqlitePool,
    actor: &Viewer,
    feedback_id: &str,
    input: &Value,
) -> ApiResult<Value> {
    if reporter_of(db, feedback_id).await? != actor.id {
        return Err(ApiError(StatusCode::NOT_FOUND, "Report not found"));
    }
    let kind = input.get("kind").and_then(Value::as_str).unwrap_or("");
    let data = input
        .get("data")
        .ok_or_else(|| bad("Attachment data required"))?;
    let (mime, bytes) = decode_attachment(kind, data)?;
    ensure_storable_size(&bytes)?;
    store_attachment(db, feedback_id, kind, &actor.id, mime, &bytes).await?;
    tracing::info!(
        component = "reports",
        operation = "add_attachment",
        kind,
        size = bytes.len(),
        "feedback.attachment_saved"
    );
    Ok(json!({ "kind": kind, "size": bytes.len() }))
}

fn decode_attachment(kind: &str, data: &Value) -> ApiResult<(&'static str, Vec<u8>)> {
    match AttachmentKind::parse(kind) {
        Some(AttachmentKind::Screenshot) => decode_screenshot(
            data.as_str()
                .ok_or_else(|| bad("Invalid screenshot data"))?,
        ),
        Some(AttachmentKind::PageState) => Ok(("text/html", page_state_bytes(data)?)),
        Some(AttachmentKind::Logs) => Ok(("application/json", encode_logs(data)?)),
        None => Err(bad("Unknown attachment kind")),
    }
}

fn decode_screenshot(data: &str) -> ApiResult<(&'static str, Vec<u8>)> {
    let (mime, encoded) = if let Some(rest) = data.strip_prefix(JPEG_DATA_URL_PREFIX) {
        ("image/jpeg", rest)
    } else if let Some(rest) = data.strip_prefix(PNG_DATA_URL_PREFIX) {
        ("image/png", rest)
    } else {
        return Err(bad("Screenshot must be a JPEG or PNG data URL"));
    };
    if exceeds_encoded_limit(encoded) {
        return Err(bad("Screenshot is too large"));
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| bad("Invalid screenshot data"))?;
    Ok((mime, bytes))
}

// Base64 grows data by 4/3; allow a little padding before decoding.
#[inline]
fn exceeds_encoded_limit(encoded: &str) -> bool {
    encoded.len() > MAX_BYTES * 4 / 3 + 4
}

fn page_state_bytes(data: &Value) -> ApiResult<Vec<u8>> {
    Ok(data
        .as_str()
        .ok_or_else(|| bad("Invalid page state"))?
        .as_bytes()
        .to_vec())
}

fn encode_logs(data: &Value) -> ApiResult<Vec<u8>> {
    let entries = data.as_array().ok_or_else(|| bad("Logs must be a list"))?;
    if entries.len() > MAX_LOG_ENTRIES {
        return Err(bad("Too many log entries"));
    }
    if !entries.iter().all(is_valid_log_entry) {
        return Err(bad("Invalid log entry"));
    }
    serde_json::to_vec(entries).map_err(internal)
}

// Exactly {level, message, at}: a known level, a bounded message and a short timestamp.
fn is_valid_log_entry(entry: &Value) -> bool {
    let level = entry.get("level").and_then(Value::as_str);
    let message = entry.get("message").and_then(Value::as_str);
    let at = entry.get("at").and_then(Value::as_str);
    matches!(level, Some("error" | "warn" | "info"))
        && message.is_some_and(|text| text.chars().count() <= MAX_LOG_MESSAGE)
        && at.is_some_and(|text| text.len() <= MAX_LOG_TIMESTAMP_BYTES)
        && entry
            .as_object()
            .is_some_and(|object| object.len() == LOG_ENTRY_FIELDS)
}

fn ensure_storable_size(bytes: &[u8]) -> ApiResult<()> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err(bad("Attachment is empty or too large"));
    }
    Ok(())
}

async fn store_attachment(
    db: &SqlitePool,
    feedback_id: &str,
    kind: &str,
    reporter_id: &str,
    mime: &str,
    bytes: &[u8],
) -> ApiResult<()> {
    sqlx::query("INSERT INTO feedback_attachments(feedback_id,kind,reporter_id,mime,bytes,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(feedback_id,kind) DO UPDATE SET mime=excluded.mime, bytes=excluded.bytes, created_at=excluded.created_at")
        .bind(feedback_id).bind(kind).bind(reporter_id).bind(mime).bind(bytes)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(db).await.map_err(internal)?;
    Ok(())
}

/// Attachment contents for the report detail view.
// Mental model: the reporter and officers may read; everyone else sees "not found", so the
// report's existence is not revealed.
pub(crate) async fn attachments(
    db: &SqlitePool,
    actor: &Viewer,
    feedback_id: &str,
) -> ApiResult<Value> {
    let reporter = reporter_of(db, feedback_id).await?;
    if !may_read_attachments(actor, &reporter) {
        return Err(ApiError(StatusCode::NOT_FOUND, "Report not found"));
    }
    let rows: Vec<(String, String, Vec<u8>, String)> = sqlx::query_as(
        "SELECT kind, mime, bytes, created_at FROM feedback_attachments WHERE feedback_id = ? ORDER BY kind",
    )
    .bind(feedback_id)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    Ok(Value::Array(
        rows.into_iter()
            .map(|(kind, mime, bytes, created_at)| attachment_json(kind, mime, bytes, created_at))
            .collect(),
    ))
}

#[inline]
fn may_read_attachments(actor: &Viewer, reporter: &str) -> bool {
    reporter == actor.id || is_officer(&actor.role)
}

fn attachment_json(kind: String, mime: String, bytes: Vec<u8>, created_at: String) -> Value {
    let content = attachment_content(&kind, &mime, &bytes);
    json!({ "kind": kind, "mime": mime, "size": bytes.len(), "createdAt": created_at, "content": content })
}

fn attachment_content(kind: &str, mime: &str, bytes: &[u8]) -> Value {
    match kind {
        "screenshot" => json!(format!("data:{mime};base64,{}", STANDARD.encode(bytes))),
        "logs" => serde_json::from_slice(bytes).unwrap_or(Value::Null),
        _ => json!(String::from_utf8_lossy(bytes)),
    }
}

/// Attachment kinds per report, for list badges.
pub(crate) async fn attachment_kinds(db: &SqlitePool) -> ApiResult<HashMap<String, Vec<String>>> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT feedback_id, kind FROM feedback_attachments ORDER BY kind")
            .fetch_all(db)
            .await
            .map_err(internal)?;
    let mut kinds: HashMap<String, Vec<String>> = HashMap::new();
    for (id, kind) in rows {
        kinds.entry(id).or_default().push(kind);
    }
    Ok(kinds)
}
