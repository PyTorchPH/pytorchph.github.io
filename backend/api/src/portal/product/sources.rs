//! Evidence sources on the Career Evidence view: connect, sync or disconnect.
//!
//! Module map (caller-first):
//!   update_source
//!   ├─ parse_source_request     known source, action, disconnect confirmation, https link
//!   │   └─ is_valid_link
//!   ├─ find_source
//!   └─ apply_source_action      connection status, sync time, configured link
use crate::portal::{
    fields::field,
    store::{current, save},
};
use crate::{ApiError, ApiResult, bad};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::SqlitePool;

const CAREER_EVIDENCE_KEY: &str = "/api/product/career-evidence";
const SOURCES: [&str; 6] = [
    "github",
    "facebook",
    "linkedin",
    "twitter",
    "instagram",
    "website",
];
const ACTIONS: [&str; 3] = ["connect", "sync", "disconnect"];

struct SourceRequest<'a> {
    action: &'a str,
    link: &'a str,
}

impl SourceRequest<'_> {
    #[inline]
    fn is_disconnect(&self) -> bool {
        self.action == "disconnect"
    }
}

// Mental model: check what the member asked for, then update that one source's entry in
// their evidence view and save it.
pub(crate) async fn update_source(
    db: &SqlitePool,
    member_id: &str,
    role: &str,
    id: &str,
    input: Value,
) -> ApiResult<Value> {
    let request = parse_source_request(id, &input)?;
    let mut view = current(db, role, member_id, CAREER_EVIDENCE_KEY).await?;
    let source = find_source(&mut view, id)?;
    apply_source_action(source, &request);
    let result = source.clone();
    save(db, member_id, CAREER_EVIDENCE_KEY, &view).await?;
    Ok(json!({"source":result}))
}

fn parse_source_request<'a>(id: &str, input: &'a Value) -> ApiResult<SourceRequest<'a>> {
    if !SOURCES.contains(&id) {
        return Err(bad("Unknown evidence source"));
    }
    let action = field(input, "action")?;
    if !ACTIONS.contains(&action) {
        return Err(bad("Invalid source action"));
    }
    let request = SourceRequest {
        action,
        link: input.get("url").and_then(Value::as_str).unwrap_or(""),
    };
    if request.is_disconnect() && input.get("confirmation").and_then(Value::as_bool) != Some(true) {
        return Err(bad("Disconnect confirmation required"));
    }
    if !request.link.is_empty() && !is_valid_link(request.link) {
        return Err(bad("Invalid source URL"));
    }
    if id == "website" && action == "connect" && request.link.is_empty() {
        return Err(bad("Portfolio URL is required"));
    }
    Ok(request)
}

/// An https URL with a host, at most 2000 characters.
#[inline]
fn is_valid_link(link: &str) -> bool {
    link.len() <= 2000
        && url::Url::parse(link)
            .is_ok_and(|url| url.scheme() == "https" && url.host_str().is_some())
}

fn find_source<'a>(view: &'a mut Value, id: &str) -> ApiResult<&'a mut Value> {
    view.pointer_mut("/evidence/sources")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| bad("Evidence sources unavailable"))?
        .iter_mut()
        .find(|source| source.get("id").and_then(Value::as_str) == Some(id))
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Source not found"))
}

fn apply_source_action(source: &mut Value, request: &SourceRequest<'_>) {
    let disconnect = request.is_disconnect();
    source["connectionStatus"] = json!(if disconnect {
        "disconnected"
    } else {
        "connected"
    });
    source["status"] = json!(if disconnect { "ready" } else { "verified" });
    if !disconnect {
        source["lastSyncedAt"] = json!(chrono::Utc::now().to_rfc3339());
    }
    if !request.link.is_empty() {
        source["configuredUrl"] = json!(request.link);
    }
    if disconnect {
        source["configuredUrl"] = Value::Null;
    }
}
