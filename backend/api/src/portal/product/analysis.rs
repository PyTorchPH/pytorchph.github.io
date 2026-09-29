//! The static evidence review: a consent-gated, no-AI proposal for one evidence item.
//!
//! Module map (caller-first):
//!   static_evidence_analysis
//!   ├─ has_consent
//!   ├─ selected_description     the item's current description, length-capped
//!   └─ static_proposal          the fixed proposal shape the UI shows
use crate::portal::fields::{field, limited};
use crate::{ApiResult, bad};
use serde_json::{Value, json};

// Mental model: require explicit consent and a selected item, then return a fixed proposal
// that keeps the member's own description; no external AI provider is contacted.
pub(crate) fn static_evidence_analysis(input: Value) -> ApiResult<Value> {
    if !has_consent(&input) {
        return Err(bad("Explicit per-analysis consent is required"));
    }
    let id = field(&input, "evidenceId")?;
    let current = input
        .get("current")
        .ok_or_else(|| bad("Current evidence is required"))?;
    let title = field(current, "title")?;
    if !limited(id, 100) || !limited(title, 200) {
        return Err(bad("A selected evidence item is required"));
    }
    let before = selected_description(current)?;
    Ok(static_proposal(before))
}

#[inline]
fn has_consent(input: &Value) -> bool {
    input.get("consent").and_then(Value::as_bool) == Some(true)
}

fn selected_description(current: &Value) -> ApiResult<&str> {
    let before = current
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");
    if before.len() > 5000 {
        return Err(bad("Evidence description is too long"));
    }
    Ok(before)
}

fn static_proposal(before: &str) -> Value {
    json!({"proposal":{"summary":"Static evidence review. No external AI provider was contacted.","changes":[{"field":"Description","before":before,"after":if before.is_empty() { "Describe the demonstrated outcome without adding unsupported metrics." } else { before }}],"warnings":["Static test data only; verify all claims against their sources."]},"provider":"static-fixture","userApprovalRequired":true})
}
