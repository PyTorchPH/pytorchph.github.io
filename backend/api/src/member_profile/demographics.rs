//! Aggregated member demographics for officers. Only members who consented are counted, and a
//! group smaller than MINIMUM_GROUP_SIZE is merged into one "Other" row so nobody stands out.
//!
//! Module map (caller-first):
//!   demographics            GET /api/officer/demographics
//!   ├─ age_buckets        current age → the range officers see
//!   ├─ grouped_counts       one breakdown: label per code, counted
//!   │   └─ labelled         code → catalog label (or the stored name)
//!   └─ suppress_small_groups
use super::{catalog, store::CURRENT_AGE};
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
            "ageRange": breakdown(age_buckets(), Some("ageRanges")).await?,
            "region": breakdown(format!("SELECT region_code, COUNT(*) FROM member_profiles WHERE member_id IN ({CONSENTED}) GROUP BY region_code"), Some("regions")).await?,
            "status": breakdown(format!("SELECT status, COUNT(*) FROM member_profiles WHERE member_id IN ({CONSENTED}) GROUP BY status"), Some("statuses")).await?,
            "channel": breakdown(format!("SELECT channel, COUNT(*) FROM member_profiles WHERE member_id IN ({CONSENTED}) GROUP BY channel"), Some("channels")).await?,
            "interest": breakdown(format!("SELECT interest_code, COUNT(*) FROM member_interests WHERE member_id IN ({CONSENTED}) GROUP BY interest_code"), Some("interests")).await?,
            "industry": breakdown(format!("SELECT industry_code, COUNT(*) FROM member_employment WHERE member_id IN ({CONSENTED}) GROUP BY industry_code"), Some("industries")).await?,
            "company": breakdown(format!("SELECT c.name, COUNT(*) FROM member_employment e JOIN companies c ON c.id = e.company_id WHERE e.member_id IN ({CONSENTED}) GROUP BY c.name"), None).await?,
            "school": breakdown(school_names(), None).await?,
        },
    }))
}

// Officers only ever see ranges: each consenting member's current age falls into one bucket,
// and a member without an age row preferred not to say.
// Schools are named (with their campus city) by joining the directory; unlisted ones stay grouped.
fn school_names() -> String {
    format!(
        "SELECT CASE WHEN e.school_code = '{unlisted}' THEN 'School not listed'          ELSE COALESCE(s.name || CASE WHEN s.city <> '' THEN ' - ' || s.city ELSE '' END, e.school_code) END AS school, COUNT(*)          FROM member_education e LEFT JOIN schools s ON s.code = e.school_code          WHERE e.member_id IN ({CONSENTED}) GROUP BY school",
        unlisted = catalog::UNLISTED_SCHOOL
    )
}

fn age_buckets() -> String {
    format!(
        "SELECT CASE WHEN a.current IS NULL THEN 'prefer_not_to_say'          WHEN a.current < 18 THEN 'under_18' WHEN a.current < 25 THEN '18_24'          WHEN a.current < 35 THEN '25_34' WHEN a.current < 45 THEN '35_44' ELSE '45_plus' END AS bucket, COUNT(*)          FROM member_profiles p LEFT JOIN (SELECT member_id, {CURRENT_AGE} AS current FROM member_ages) a ON a.member_id = p.member_id          WHERE p.member_id IN ({CONSENTED}) GROUP BY bucket"
    )
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
