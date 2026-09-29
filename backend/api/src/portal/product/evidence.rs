//! Manual career evidence items on the member's Career Evidence view.
//!
//! Module map (caller-first):
//!   save_manual_evidence
//!   ├─ parse_title_and_source      title and optional http(s) source link
//!   │   └─ is_valid_source
//!   ├─ evidence_id                 a new id, or the edited one
//!   ├─ parse_media                 media URL and its description
//!   ├─ verification_state          approved by the member, or still a draft
//!   ├─ evidence_record             the stored item
//!   │   ├─ bounded_text
//!   │   └─ evidence_kind
//!   ├─ upsert_manual_item          replace the edited manual item, or add a new one first
//!   └─ queue_for_review            approved items go to officer review
use crate::evidence::integrity;
use crate::portal::{
    fields::{bounded_strings, field, limited},
    store::{current, save},
};
use crate::{ApiError, ApiResult, bad};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use uuid::Uuid;

const CAREER_EVIDENCE_KEY: &str = "/api/product/career-evidence";
const PLACEHOLDER_MEDIA: &str = "/demo/evidence/manual-placeholder.svg";

// Mental model: validate the submitted item field by field, store it in the member's
// evidence list, and when the member approved it, queue the same item for officer review.
pub(crate) async fn save_manual_evidence(
    db: &SqlitePool,
    member_id: &str,
    role: &str,
    target: Option<&str>,
    input: Value,
) -> ApiResult<Value> {
    let supplied = input
        .get("item")
        .ok_or_else(|| bad("Evidence item required"))?;
    let (title, source) = parse_title_and_source(supplied)?;
    let id = evidence_id(target)?;
    let (media, media_alt) = parse_media(supplied)?;
    let state = verification_state(&input);
    let item = evidence_record(supplied, &id, title, source, media, media_alt, state)?;
    let mut view = current(db, role, member_id, CAREER_EVIDENCE_KEY).await?;
    upsert_manual_item(&mut view, target.is_some(), &id, &item)?;
    save(db, member_id, CAREER_EVIDENCE_KEY, &view).await?;
    if state == "user_verified" {
        queue_for_review(db, member_id, &id, &item, title, source).await?;
    }
    Ok(json!({"item":item}))
}

fn parse_title_and_source(supplied: &Value) -> ApiResult<(&str, &str)> {
    let title = field(supplied, "title")?.trim();
    let source = supplied
        .get("sourceUrl")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !limited(title, 200) || !is_valid_source(source) || source.len() > 2000 {
        return Err(bad("Invalid evidence item"));
    }
    Ok((title, source))
}

/// Empty, or an absolute http(s) URL with a host.
#[inline]
fn is_valid_source(source: &str) -> bool {
    source.is_empty()
        || url::Url::parse(source)
            .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
}

fn evidence_id(target: Option<&str>) -> ApiResult<String> {
    let id = target
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    if Uuid::parse_str(&id).is_err() {
        return Err(bad("Invalid evidence ID"));
    }
    Ok(id)
}

fn parse_media(supplied: &Value) -> ApiResult<(&str, &str)> {
    let media = supplied
        .get("mediaUrl")
        .and_then(Value::as_str)
        .unwrap_or(PLACEHOLDER_MEDIA);
    if media.len() > 4000 || !(media.starts_with('/') || media.starts_with("https://")) {
        return Err(bad("Invalid evidence media URL"));
    }
    let media_alt = supplied
        .get("mediaAlt")
        .and_then(Value::as_str)
        .unwrap_or("Manual evidence");
    if media_alt.len() > 300 {
        return Err(bad("Evidence media description is too long"));
    }
    Ok((media, media_alt))
}

#[inline]
fn verification_state(input: &Value) -> &'static str {
    if input.get("approve").and_then(Value::as_bool) == Some(true) {
        "user_verified"
    } else {
        "draft"
    }
}

fn evidence_record(
    supplied: &Value,
    id: &str,
    title: &str,
    source: &str,
    media: &str,
    media_alt: &str,
    state: &str,
) -> ApiResult<Value> {
    Ok(json!({
        "id":id,"sourceId":"manual","evidenceKind":evidence_kind(supplied),
        "collectionOrigin":"manual","title":title,"organization":bounded_text(supplied,"organization",200)?,"role":bounded_text(supplied,"role",200)?,
        "dateLabel":bounded_text(supplied,"dateLabel",100)?,"description":bounded_text(supplied,"description",5000)?,
        "quantitative":bounded_strings(supplied.get("quantitative"),25,500)?,"qualitative":bounded_strings(supplied.get("qualitative"),25,500)?,
        "skills":bounded_strings(supplied.get("skills"),50,100)?,"mediaUrl":media,
        "mediaAlt":media_alt,
        "verificationState":state,"sourceUrl":source,
    }))
}

fn bounded_text(supplied: &Value, key: &str, max: usize) -> ApiResult<String> {
    let value = supplied
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if value.len() > max {
        return Err(bad("Evidence field is too long"));
    }
    Ok(value.to_owned())
}

/// "experience" is kept; anything else is a project.
#[inline]
fn evidence_kind(supplied: &Value) -> &str {
    supplied
        .get("evidenceKind")
        .and_then(Value::as_str)
        .filter(|kind| *kind == "experience")
        .unwrap_or("project")
}

fn upsert_manual_item(view: &mut Value, is_edit: bool, id: &str, item: &Value) -> ApiResult<()> {
    let items = view
        .pointer_mut("/evidence/items")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| bad("Evidence view unavailable"))?;
    if is_edit {
        let record = items
            .iter_mut()
            .find(|record| is_manual_item(record, id))
            .ok_or(ApiError(StatusCode::NOT_FOUND, "Manual evidence not found"))?;
        *record = item.clone();
    } else {
        items.insert(0, item.clone());
    }
    Ok(())
}

#[inline]
fn is_manual_item(record: &Value, id: &str) -> bool {
    record.get("id").and_then(Value::as_str) == Some(id)
        && record.get("sourceId").and_then(Value::as_str) == Some("manual")
}

async fn queue_for_review(
    db: &SqlitePool,
    member_id: &str,
    id: &str,
    item: &Value,
    title: &str,
    source: &str,
) -> ApiResult<()> {
    integrity::queue_manual_claim(
        db,
        member_id,
        id,
        item["evidenceKind"].as_str().unwrap_or("project"),
        title,
        source,
        item["description"].as_str().unwrap_or(""),
    )
    .await
}
