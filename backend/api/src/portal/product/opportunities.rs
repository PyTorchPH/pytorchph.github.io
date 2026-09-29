//! Manually tracked job opportunities on the member's Opportunities view.
//!
//! Module map (caller-first):
//!   save_opportunity
//!   ├─ ensure_opportunity_keys   5–7 known keys
//!   ├─ parse_opportunity         company, title, location, work mode, stage, fit
//!   │   └─ is_valid_opportunity
//!   ├─ opportunity_id            a new id, or the edited one (must match the body)
//!   └─ upsert_manual             replace the edited manual record, or add a new one first
//!       └─ is_manual_record
use crate::portal::{
    fields::{field, limited},
    store::{current, save},
};
use crate::{ApiError, ApiResult, bad};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use uuid::Uuid;

const OPPORTUNITIES_KEY: &str = "/api/product/opportunities";
const KEYS: [&str; 6] = ["company", "title", "location", "workMode", "stage", "fit"];
const WORK_MODES: [&str; 5] = ["remote", "hybrid", "onsite", "any", "unknown"];
const STAGES: [&str; 8] = [
    "discovered",
    "saved",
    "drafted",
    "human_review",
    "applied",
    "rejected",
    "withdrawn",
    "confirmed",
];

struct Opportunity<'a> {
    company: &'a str,
    title: &'a str,
    location: &'a str,
    work_mode: &'a str,
    stage: &'a str,
    fit: Option<i64>,
}

// Mental model: validate the submitted opportunity, then add it (new) or replace it (edit)
// in the member's manual list and save the view.
pub(crate) async fn save_opportunity(
    db: &SqlitePool,
    member_id: &str,
    role: &str,
    target: Option<&str>,
    input: Value,
) -> ApiResult<Value> {
    ensure_opportunity_keys(&input)?;
    let opportunity = parse_opportunity(&input)?;
    let id = opportunity_id(target, &input)?;
    let mut view = current(db, role, member_id, OPPORTUNITIES_KEY).await?;
    let record = opportunity_record(&opportunity, &id);
    upsert_manual(&mut view, target.is_some(), &id, &record)?;
    save(db, member_id, OPPORTUNITIES_KEY, &view).await?;
    Ok(json!({"opportunity":record}))
}

fn ensure_opportunity_keys(input: &Value) -> ApiResult<()> {
    let object = input
        .as_object()
        .ok_or_else(|| bad("Invalid opportunity"))?;
    let known_keys = object
        .keys()
        .all(|key| KEYS.contains(&key.as_str()) || key == "id");
    if object.len() < 5 || object.len() > 7 || !known_keys {
        return Err(bad("Invalid opportunity"));
    }
    Ok(())
}

fn parse_opportunity(input: &Value) -> ApiResult<Opportunity<'_>> {
    let opportunity = Opportunity {
        company: field(input, "company")?.trim(),
        title: field(input, "title")?.trim(),
        location: input
            .get("location")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim(),
        work_mode: field(input, "workMode")?,
        stage: field(input, "stage")?,
        fit: input.get("fit").and_then(Value::as_i64),
    };
    if !is_valid_opportunity(&opportunity, input) {
        return Err(bad("Invalid opportunity"));
    }
    Ok(opportunity)
}

fn is_valid_opportunity(opportunity: &Opportunity<'_>, input: &Value) -> bool {
    let fit_in_range = opportunity
        .fit
        .is_none_or(|value| (0..=100).contains(&value));
    let fit_is_number_or_null = input
        .get("fit")
        .is_none_or(|value| value.is_null() || opportunity.fit.is_some());
    limited(opportunity.company, 200)
        && limited(opportunity.title, 200)
        && opportunity.location.len() <= 200
        && WORK_MODES.contains(&opportunity.work_mode)
        && STAGES.contains(&opportunity.stage)
        && fit_in_range
        && fit_is_number_or_null
}

fn opportunity_id(target: Option<&str>, input: &Value) -> ApiResult<String> {
    let id = target
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let body_id_differs = input
        .get("id")
        .and_then(Value::as_str)
        .is_some_and(|value| value != id);
    if Uuid::parse_str(&id).is_err() || body_id_differs {
        return Err(bad("Invalid opportunity ID"));
    }
    Ok(id)
}

#[inline]
fn opportunity_record(opportunity: &Opportunity<'_>, id: &str) -> Value {
    json!({"id":id,"company":opportunity.company,"title":opportunity.title,"location":opportunity.location,"workMode":opportunity.work_mode,"stage":opportunity.stage,"fit":opportunity.fit,"salaryBand":null,"nextStage":null,"recordOrigin":"manual"})
}

fn upsert_manual(view: &mut Value, is_edit: bool, id: &str, record: &Value) -> ApiResult<()> {
    let items = view
        .get_mut("opportunities")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| bad("Opportunity view unavailable"))?;
    if is_edit {
        let existing = items
            .iter_mut()
            .find(|item| is_manual_record(item, id))
            .ok_or(ApiError(
                StatusCode::NOT_FOUND,
                "Manual opportunity not found",
            ))?;
        *existing = record.clone();
    } else {
        items.insert(0, record.clone());
    }
    Ok(())
}

#[inline]
fn is_manual_record(item: &Value, id: &str) -> bool {
    item.get("id").and_then(Value::as_str) == Some(id)
        && item.get("recordOrigin").and_then(Value::as_str) == Some("manual")
}
