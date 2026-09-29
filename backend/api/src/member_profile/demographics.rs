//! Aggregated member demographics for officers. Only members who consented are counted, and a
//! group smaller than MINIMUM_GROUP_SIZE is merged into one "Other" row so nobody stands out.
//!
//! Module map (caller-first):
//!   demographics            GET /api/officer/demographics
//!   ├─ grouped_counts       one breakdown: label per code, counted
//!   │   └─ labelled         code → catalog label (or the stored name)
//!   └─ suppress_small_groups
use super::catalog;
use crate::{ApiResult, internal};
use serde_json::{Value, json};
use sqlx::SqlitePool;

pub(crate) const MINIMUM_GROUP_SIZE: i64 = 5;
const OTHER_LABEL: &str = "Other (fewer than 5)";

const CONSENTED: &str = "SELECT member_id FROM member_analytics_consents";

// Mental model: each breakdown is "count consenting members by one answer"; codes are turned
// into readable labels from the catalogs, then tiny groups are folded together.
pub(crate) async fn demographics(db: &SqlitePool) -> ApiResult<Value> {
    let (respondents,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM member_profiles")
        .fetch_one(db)
        .await
        .map_err(internal)?;
    let (consented,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM member_analytics_consents")
        .fetch_one(db)
        .await
        .map_err(internal)?;
    let breakdown = |sql: String, list: Option<&'static str>| grouped_counts(db, sql, list);
    Ok(json!({
        "respondents": respondents,
        "consented": consented,
        "minimumGroupSize": MINIMUM_GROUP_SIZE,
        "breakdowns": {
            "gender": breakdown(format!("SELECT gender, COUNT(*) FROM member_profiles WHERE member_id IN ({CONSENTED}) GROUP BY gender"), Some("genders")).await?,
            "ageRange": breakdown(format!("SELECT age_range, COUNT(*) FROM member_profiles WHERE member_id IN ({CONSENTED}) GROUP BY age_range"), Some("ageRanges")).await?,
            "region": breakdown(format!("SELECT region_code, COUNT(*) FROM member_profiles WHERE member_id IN ({CONSENTED}) GROUP BY region_code"), Some("regions")).await?,
            "status": breakdown(format!("SELECT status, COUNT(*) FROM member_profiles WHERE member_id IN ({CONSENTED}) GROUP BY status"), Some("statuses")).await?,
            "channel": breakdown(format!("SELECT channel, COUNT(*) FROM member_profiles WHERE member_id IN ({CONSENTED}) GROUP BY channel"), Some("channels")).await?,
            "interest": breakdown(format!("SELECT interest_code, COUNT(*) FROM member_interests WHERE member_id IN ({CONSENTED}) GROUP BY interest_code"), Some("interests")).await?,
            "industry": breakdown(format!("SELECT industry_code, COUNT(*) FROM member_employment WHERE member_id IN ({CONSENTED}) GROUP BY industry_code"), Some("industries")).await?,
            "company": breakdown(format!("SELECT c.name, COUNT(*) FROM member_employment e JOIN companies c ON c.id = e.company_id WHERE e.member_id IN ({CONSENTED}) GROUP BY c.name"), None).await?,
            "school": breakdown(format!("SELECT e.school_code, COUNT(*) FROM member_education e WHERE e.member_id IN ({CONSENTED}) GROUP BY e.school_code"), Some("schools")).await?,
        },
    }))
}

async fn grouped_counts(
    db: &SqlitePool,
    sql: String,
    list: Option<&'static str>,
) -> ApiResult<Value> {
    let rows: Vec<(String, i64)> = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .fetch_all(db)
        .await
        .map_err(internal)?;
    let labelled: Vec<(String, i64)> = rows
        .into_iter()
        .map(|(code, count)| (labelled(list, &code), count))
        .collect();
    Ok(suppress_small_groups(labelled))
}

fn labelled(list: Option<&'static str>, code: &str) -> String {
    match list {
        Some("schools") if code == catalog::UNLISTED_SCHOOL => "School not listed".to_owned(),
        Some("schools") => {
            catalog::school(code).map_or_else(|| code.to_owned(), |school| school.name.clone())
        }
        Some(list) => catalog::option_label(list, code).unwrap_or(code).to_owned(),
        None => code.to_owned(),
    }
}

fn suppress_small_groups(rows: Vec<(String, i64)>) -> Value {
    let (mut shown, hidden): (Vec<_>, Vec<_>) = rows
        .into_iter()
        .partition(|(_, count)| is_reportable(*count));
    shown.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let hidden_total: i64 = hidden.iter().map(|(_, count)| count).sum();
    let mut items: Vec<Value> = shown
        .into_iter()
        .map(|(label, count)| json!({"label": label, "count": count}))
        .collect();
    if hidden_total > 0 {
        items.push(json!({"label": OTHER_LABEL, "count": hidden_total}));
    }
    Value::Array(items)
}

#[inline]
fn is_reportable(count: i64) -> bool {
    count >= MINIMUM_GROUP_SIZE
}
