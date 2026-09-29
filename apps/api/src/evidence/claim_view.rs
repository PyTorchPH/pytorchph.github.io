//! Claims as the portal's review queue shows them (`EvidenceClaim`).
//!
//! Module map (caller-first):
//!   officer_claims       review queue: pending and disputed first, then latest decisions
//!   one_claim            one claim after a decision
//!   └─ claim_json        one row in the EvidenceClaim shape
//!      ├─ provenance     officer_reviewed · rejected · disputed · scraped/manual pending
//!      └─ non_empty_url
use super::claim_labels::{department, member_label};
use crate::{ApiError, ApiResult, internal};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::{Row, SqlitePool, sqlite::SqliteRow};

const CLAIM_COLUMNS: &str = "c.id, c.member_id, c.kind, c.title, c.source_url, c.source, c.origin, \
    c.content_hash, c.status, c.points, c.review_reason, COALESCE(c.reviewed_at, c.created_at), \
    (SELECT r.decision FROM evidence_claim_reviews r WHERE r.claim_id = c.id ORDER BY r.reviewed_at DESC LIMIT 1), \
    (SELECT r.verified_level FROM evidence_claim_reviews r WHERE r.claim_id = c.id AND r.verified_level IS NOT NULL ORDER BY r.reviewed_at DESC LIMIT 1)";

/// Review queue: pending and disputed claims first, then the latest decisions.
pub(crate) async fn officer_claims(db: &SqlitePool) -> ApiResult<Value> {
    let sql = format!(
        "SELECT {CLAIM_COLUMNS} FROM evidence_claims c \
         ORDER BY c.status = 'pending' DESC, c.created_at LIMIT 200"
    );
    let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
        .fetch_all(db)
        .await
        .map_err(internal)?;
    Ok(Value::Array(rows.iter().map(claim_json).collect()))
}

pub(crate) async fn one_claim(db: &SqlitePool, id: &str) -> ApiResult<Value> {
    let sql = format!("SELECT {CLAIM_COLUMNS} FROM evidence_claims c WHERE c.id = ?");
    let row = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(id)
        .fetch_optional(db)
        .await
        .map_err(internal)?
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Claim not found"))?;
    Ok(claim_json(&row))
}

fn claim_json(row: &SqliteRow) -> Value {
    let status: String = row.get(8);
    let origin: String = row.get(6);
    let last_decision: Option<String> = row.get(12);
    let member_id: String = row.get(1);
    let kind: String = row.get(2);
    let level: Option<String> = row.get(13);
    let mut claim = json!({
        "id": row.get::<String, _>(0),
        "memberLabel": member_label(&member_id),
        "title": row.get::<String, _>(3),
        "source": row.get::<String, _>(5),
        "provenance": provenance(&status, &origin, last_decision.as_deref()),
        "department": department(&kind),
        "sourceUrl": non_empty_url(row.get::<String, _>(4)),
        "contentHash": row.get::<String, _>(7),
        "points": row.get::<Option<i64>, _>(9).unwrap_or(0).max(0),
        "origin": origin,
        "decisionReason": row.get::<Option<String>, _>(10),
        "updatedAt": row.get::<String, _>(11),
    });
    if let Some(level) = level {
        claim["proposedLevel"] = json!(level);
    }
    claim
}

fn provenance(status: &str, origin: &str, last_decision: Option<&str>) -> &'static str {
    match status {
        "approved" => "officer_reviewed",
        "rejected" => "rejected",
        _ if last_decision == Some("scraper_defect") => "disputed",
        _ if origin == "extension_scrape" => "scraped_pending",
        _ => "manual_pending",
    }
}

#[inline]
fn non_empty_url(url: String) -> Option<String> {
    Some(url).filter(|url| !url.is_empty())
}
