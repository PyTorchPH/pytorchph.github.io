//! Demo fixtures: the fallback content of every portal view.
//!
//! Module map (caller-first):
//!   fixture                        status + body of a view for a role
//!   ├─ fixture_audience            which fixture set (member or officer) the role reads
//!   │   └─ is_officer_view
//!   ├─ fixture_item                the exact key, else the key without its query
//!   │   └─ fixtures                the parsed seed file, loaded once
//!   └─ share_career_capabilities   members get the officer set's capability rules
use super::is_officer;
use axum::http::StatusCode;
use serde_json::Value;
use std::sync::OnceLock;

static FIXTURES: OnceLock<Value> = OnceLock::new();
const CAPABILITIES_KEY: &str = "/api/capabilities";

pub(crate) fn fixture(role: &str, key: &str) -> Option<(StatusCode, Value)> {
    let item = fixture_item(fixture_audience(role, key), key)?;
    let status = StatusCode::from_u16(item.get("status")?.as_u64()? as u16).ok()?;
    let mut body = item.get("body")?.clone();
    if key == CAPABILITIES_KEY && !is_officer(role) {
        share_career_capabilities(&mut body, key)?;
    }
    Some((status, body))
}

// An officer is an elevated member: their own views use the member fixtures, and only
// organization-wide officer data and the officer portal manifest use the officer set.
fn fixture_audience(role: &str, key: &str) -> &'static str {
    if is_officer(role) && is_officer_view(key) {
        "officer"
    } else {
        "member"
    }
}

#[inline]
fn is_officer_view(key: &str) -> bool {
    key == CAPABILITIES_KEY || key.starts_with("/api/officer/") || key.starts_with("/api/feedback")
}

fn fixture_item(audience: &str, key: &str) -> Option<&'static Value> {
    let set = fixtures().get(audience)?;
    set.get(key).or_else(|| set.get(key.split('?').next()?))
}

fn fixtures() -> &'static Value {
    FIXTURES.get_or_init(|| {
        serde_json::from_str(include_str!("../../seeds/demo-fixtures.json"))
            .expect("checked demo fixtures")
    })
}

// Career tools follow the same rules for every signed-in member; only the portal block
// (officer tools, diagnostics) differs by role.
fn share_career_capabilities(body: &mut Value, key: &str) -> Option<()> {
    let shared = fixture_item("officer", key)?
        .get("body")?
        .get("capabilities")?;
    body["capabilities"] = shared.clone();
    Some(())
}
