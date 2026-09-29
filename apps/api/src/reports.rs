//! Bug report attachments: recent console logs, a sanitized page-state snapshot, and an
//! extension screenshot. Stored once per report and kind; visible to officers and the reporter.
use crate::{ApiError, ApiResult, auth::Viewer, bad, internal, portal::feedback_rows};
use axum::http::StatusCode;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use std::collections::HashMap;

const MAX_BYTES: usize = 262_144;
const MAX_LOG_ENTRIES: usize = 100;
const MAX_LOG_MESSAGE: usize = 500;

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

fn screenshot(data: &str) -> ApiResult<(&'static str, Vec<u8>)> {
    let (mime, encoded) = if let Some(rest) = data.strip_prefix("data:image/jpeg;base64,") {
        ("image/jpeg", rest)
    } else if let Some(rest) = data.strip_prefix("data:image/png;base64,") {
        ("image/png", rest)
    } else {
        return Err(bad("Screenshot must be a JPEG or PNG data URL"));
    };
    if encoded.len() > MAX_BYTES * 4 / 3 + 4 {
        return Err(bad("Screenshot is too large"));
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| bad("Invalid screenshot data"))?;
    Ok((mime, bytes))
}

fn logs(data: &Value) -> ApiResult<Vec<u8>> {
    let entries = data.as_array().ok_or_else(|| bad("Logs must be a list"))?;
    if entries.len() > MAX_LOG_ENTRIES {
        return Err(bad("Too many log entries"));
    }
    let valid = entries.iter().all(|entry| {
        let level = entry.get("level").and_then(Value::as_str);
        let message = entry.get("message").and_then(Value::as_str);
        let at = entry.get("at").and_then(Value::as_str);
        matches!(level, Some("error" | "warn" | "info"))
            && message.is_some_and(|text| text.chars().count() <= MAX_LOG_MESSAGE)
            && at.is_some_and(|text| text.len() <= 40)
            && entry.as_object().is_some_and(|object| object.len() == 3)
    });
    if !valid {
        return Err(bad("Invalid log entry"));
    }
    serde_json::to_vec(entries).map_err(internal)
}

/// The reporter attaches one item per kind to their own report.
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
    let (mime, bytes) = match kind {
        "screenshot" => screenshot(
            data.as_str()
                .ok_or_else(|| bad("Invalid screenshot data"))?,
        )?,
        "page_state" => (
            "text/html",
            data.as_str()
                .ok_or_else(|| bad("Invalid page state"))?
                .as_bytes()
                .to_vec(),
        ),
        "logs" => ("application/json", logs(data)?),
        _ => return Err(bad("Unknown attachment kind")),
    };
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err(bad("Attachment is empty or too large"));
    }
    sqlx::query("INSERT INTO feedback_attachments(feedback_id,kind,reporter_id,mime,bytes,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(feedback_id,kind) DO UPDATE SET mime=excluded.mime, bytes=excluded.bytes, created_at=excluded.created_at")
        .bind(feedback_id).bind(kind).bind(&actor.id).bind(mime).bind(&bytes)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(db).await.map_err(internal)?;
    tracing::info!(
        component = "reports",
        operation = "add_attachment",
        kind,
        size = bytes.len(),
        "feedback.attachment_saved"
    );
    Ok(json!({ "kind": kind, "size": bytes.len() }))
}

/// Attachment contents for the report detail view.
pub(crate) async fn attachments(
    db: &SqlitePool,
    actor: &Viewer,
    feedback_id: &str,
) -> ApiResult<Value> {
    let reporter = reporter_of(db, feedback_id).await?;
    if reporter != actor.id && !is_officer(&actor.role) {
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
            .map(|(kind, mime, bytes, created_at)| {
                let content = match kind.as_str() {
                    "screenshot" => json!(format!("data:{mime};base64,{}", STANDARD.encode(&bytes))),
                    "logs" => serde_json::from_slice(&bytes).unwrap_or(Value::Null),
                    _ => json!(String::from_utf8_lossy(&bytes)),
                };
                json!({ "kind": kind, "mime": mime, "size": bytes.len(), "createdAt": created_at, "content": content })
            })
            .collect(),
    ))
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
