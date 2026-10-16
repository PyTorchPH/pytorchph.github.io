//! Implicit deny: omit free text; emit only controlled categories, types and month buckets.
use super::key::PrivacyKey;
use crate::{ApiResult, bad, internal};
use chrono::{DateTime, NaiveDate};
use serde::Deserialize;
use serde_json::{Value, json};

pub(crate) const POLICY_VERSION: &str = "achievement-ai-v1";

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ProjectionInput {
    pub(crate) purpose: String,
    #[serde(default)]
    pub(crate) omit_fields: Vec<String>,
    pub(crate) view: Option<String>,
}

pub(crate) fn policy() -> Value {
    json!({"version":POLICY_VERSION,"default":"deny","purposes":["learning_recommendations","officer_assistant"],"trainingEnabled":false,"publicOfficerViews":{"event_schedules":{"fields":["id","title","startsAt","dateStatus","scheduleLabel","series","modules"],"source":"published_learning_schedules","excludes":["member_id","email","created_by","private_drafts"]}},"fields":{
        "member_id":{"sensitive_data":true,"transform":"pseudonymize"},
        "name":{"sensitive_data":true,"transform":"omit"},
        "email":{"sensitive_data":true,"transform":"omit"},
        "title":{"sensitive_data":true,"transform":"omit"},
        "description":{"sensitive_data":true,"transform":"omit"},
        "links":{"sensitive_data":true,"transform":"omit"},
        "images":{"sensitive_data":true,"transform":"omit"},
        "skills":{"sensitive_data":false,"transform":"controlled_categories"},
        "achievement_type":{"sensitive_data":false,"transform":"controlled_enum"},
        "completion_month":{"sensitive_data":false,"transform":"month_only"}}})
}

pub(crate) fn validate(input: &ProjectionInput) -> ApiResult<()> {
    if !["learning_recommendations", "officer_assistant"].contains(&input.purpose.as_str())
        || input.omit_fields.len() > 3
        || input.omit_fields.iter().any(|field| {
            !["skills", "achievement_type", "completion_month"].contains(&field.as_str())
        })
    {
        return Err(bad("Unreviewed AI purpose or field policy"));
    }
    if input.purpose == "learning_recommendations" && input.view.is_some() {
        return Err(bad("Learning projection has no officer view"));
    }
    Ok(())
}

pub(crate) fn achievements(
    key: &PrivacyKey,
    member: &str,
    source: &Value,
    input: &ProjectionInput,
) -> ApiResult<Value> {
    let items = source
        .pointer("/evidence/items")
        .and_then(Value::as_array)
        .ok_or(bad("No server-owned achievement records"))?;
    if items.len() > 100 {
        return Err(bad("Too many achievement records"));
    }
    let mut projected = Vec::new();
    for item in items {
        if !matches!(
            item.get("verificationState").and_then(Value::as_str),
            Some("source_matched" | "user_verified")
        ) {
            continue;
        }
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 128)
            .ok_or(bad("Invalid achievement reference"))?;
        let identity = serde_json::to_string(&(member, id)).map_err(internal)?;
        let mut record = json!({"reference":key.alias(&input.purpose,"achievement", &identity)?});
        if !input.omit_fields.iter().any(|field| field == "skills") {
            let categories = item
                .get("skills")
                .and_then(Value::as_array)
                .map(|skills| {
                    skills
                        .iter()
                        .filter_map(|skill| category(skill.as_str()?))
                        .collect::<std::collections::BTreeSet<_>>()
                })
                .unwrap_or_default();
            record["skills"] = json!(categories);
        }
        if !input
            .omit_fields
            .iter()
            .any(|field| field == "achievement_type")
        {
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
            record["achievement_type"] = json!(match kind {
                "project" | "course" | "award" | "certificate" | "competition" | "publication" =>
                    kind,
                _ => "achievement",
            });
        }
        if !input
            .omit_fields
            .iter()
            .any(|field| field == "completion_month")
            && let Some(month) = item
                .get("completedAt")
                .and_then(Value::as_str)
                .and_then(month)
        {
            record["completion_month"] = json!(month);
        }
        projected.push(record);
    }
    if projected.is_empty() {
        return Err(bad("No verified server-owned achievements are available"));
    }
    Ok(
        json!({"subjectAlias":key.alias(&input.purpose,"member",member)?,"policyVersion":POLICY_VERSION,"achievements":projected}),
    )
}

fn category(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "pytorch" | "tensorflow" | "machine learning" | "deep learning" => Some("machine_learning"),
        "python" | "rust" | "javascript" | "software engineering" => Some("engineering"),
        "sql" | "data science" | "data analysis" => Some("data_science"),
        "mathematics" | "statistics" | "linear algebra" => Some("mathematics"),
        _ => None,
    }
}

fn month(value: &str) -> Option<String> {
    if let Ok(date) = DateTime::parse_from_rfc3339(value) {
        return Some(date.format("%Y-%m").to_string());
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()
        .map(|date| date.format("%Y-%m").to_string())
}
