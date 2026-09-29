//! Platform endpoints behind the portal: client operational events and the AI provider list.
//!
//! Module map (caller-first):
//!   operational_event
//!   ├─ ensure_event_ids           eventId and correlationId are UUIDs
//!   ├─ ensure_event_metadata      retryable flag, RFC 3339 time, route
//!   ├─ is_event_token             component, stage and code shape
//!   └─ log_operational_event
//!   ai_providers                  the LiteLLM provider catalog (keys stay in the extension)
use super::fields::field;
use crate::{ApiResult, bad, identity::session::Viewer};
use serde_json::{Value, json};
use uuid::Uuid;

const SEVERITIES: [&str; 4] = ["info", "warning", "error", "critical"];
const OUTCOMES: [&str; 3] = ["succeeded", "stopped", "failed"];

// Mental model: accept only a well-formed, bounded event from the browser and record it in
// the server log; nothing is stored.
pub(crate) fn operational_event(actor: &Viewer, input: Value) -> ApiResult<Value> {
    ensure_event_ids(&input)?;
    ensure_event_metadata(&input)?;
    let component = field(&input, "component")?;
    let stage = field(&input, "stage")?;
    let code = field(&input, "code")?;
    let severity = field(&input, "severity")?;
    let outcome = field(&input, "outcome")?;
    let tokens_ok = [component, stage, code]
        .iter()
        .all(|value| is_event_token(value));
    if !tokens_ok || !SEVERITIES.contains(&severity) || !OUTCOMES.contains(&outcome) {
        return Err(bad("Invalid operational event"));
    }
    tracing::info!(event="portal.client.operation", component=%component, stage=%stage, code=%code, severity=%severity, outcome=%outcome, actor_id=%actor.id);
    Ok(json!({"accepted":true}))
}

fn ensure_event_ids(input: &Value) -> ApiResult<()> {
    for key in ["eventId", "correlationId"] {
        if Uuid::parse_str(field(input, key)?).is_err() {
            return Err(bad("Invalid operational event ID"));
        }
    }
    Ok(())
}

fn ensure_event_metadata(input: &Value) -> ApiResult<()> {
    let retryable_ok = input.get("retryable").and_then(Value::as_bool).is_some();
    let occurred_ok = input
        .get("occurredAt")
        .and_then(Value::as_str)
        .is_some_and(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok());
    if !retryable_ok || !occurred_ok || !field(input, "route")?.starts_with('/') {
        return Err(bad("Invalid operational event metadata"));
    }
    Ok(())
}

/// 2–120 lowercase letters, digits, `_`, `.` or `-`.
#[inline]
fn is_event_token(value: &str) -> bool {
    (2..=120).contains(&value.len())
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_.-".contains(&byte)
        })
}

// The LiteLLM provider catalog (same list as the resume builder's local config).
pub(crate) fn ai_providers() -> Value {
    json!({
        "middleware": "extension",
        "providers": serde_json::from_str::<Value>(include_str!("../../seeds/ai-providers.json"))
            .unwrap_or_else(|_| json!([])),
    })
}
