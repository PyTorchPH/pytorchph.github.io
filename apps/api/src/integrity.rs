//! Officer evidence review with the published point rubric, leaderboard integrity
//! sanctions, and member appeals. Response shapes match the portal UI contracts
//! (`EvidenceClaim`, `EvidenceIntegrityCase`, `OfficerEvidenceAppeal`).
use crate::{ApiError, ApiResult, auth::Viewer, bad, internal};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool, sqlite::SqliteRow};
use uuid::Uuid;

const LEVELS: [&str; 4] = [
    "participation",
    "contributor",
    "finalist_lead",
    "winner_top_award",
];

pub(crate) fn member_label(member_id: &str) -> String {
    let short: String = member_id.chars().take(8).collect();
    format!("Member {}", short.to_uppercase())
}

// The officer department responsible for a claim follows from its kind.
fn department(kind: &str) -> &'static str {
    match kind {
        "external_competition" | "external_participation" => "external_relations",
        _ => "academics",
    }
}

fn source_weight(source: &str) -> f64 {
    if source == "github" { 2.0 } else { 3.0 }
}

/// Weighted points for a verified level under the newest published rubric.
pub(crate) async fn rubric_points(
    conn: &mut sqlx::SqliteConnection,
    source: &str,
    level: &str,
) -> ApiResult<Option<(i64, i64)>> {
    let row: Option<(i64, i64)> = sqlx::query_as(
        "SELECT l.rubric_version, l.units FROM point_rubric_levels l \
         JOIN point_rubric_versions v ON v.version = l.rubric_version \
         WHERE l.level = ? AND v.published_at IS NOT NULL ORDER BY l.rubric_version DESC LIMIT 1",
    )
    .bind(level)
    .fetch_optional(conn)
    .await
    .map_err(internal)?;
    Ok(row.map(|(version, units)| {
        (
            version,
            ((units * 10) as f64 * source_weight(source)).round() as i64,
        )
    }))
}

const CLAIM_COLUMNS: &str = "c.id, c.member_id, c.kind, c.title, c.source_url, c.source, c.origin, \
    c.content_hash, c.status, c.points, c.review_reason, COALESCE(c.reviewed_at, c.created_at), \
    (SELECT r.decision FROM evidence_claim_reviews r WHERE r.claim_id = c.id ORDER BY r.reviewed_at DESC LIMIT 1), \
    (SELECT r.verified_level FROM evidence_claim_reviews r WHERE r.claim_id = c.id AND r.verified_level IS NOT NULL ORDER BY r.reviewed_at DESC LIMIT 1)";

fn claim_json(row: &SqliteRow) -> Value {
    let status: String = row.get(8);
    let origin: String = row.get(6);
    let last_decision: Option<String> = row.get(12);
    let provenance = match status.as_str() {
        "approved" => "officer_reviewed",
        "rejected" => "rejected",
        _ if last_decision.as_deref() == Some("scraper_defect") => "disputed",
        _ if origin == "extension_scrape" => "scraped_pending",
        _ => "manual_pending",
    };
    let member_id: String = row.get(1);
    let kind: String = row.get(2);
    let level: Option<String> = row.get(13);
    let mut claim = json!({
        "id": row.get::<String, _>(0),
        "memberLabel": member_label(&member_id),
        "title": row.get::<String, _>(3),
        "source": row.get::<String, _>(5),
        "provenance": provenance,
        "department": department(&kind),
        "sourceUrl": Some(row.get::<String, _>(4)).filter(|url| !url.is_empty()),
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

async fn one_claim(db: &SqlitePool, id: &str) -> ApiResult<Value> {
    let sql = format!("SELECT {CLAIM_COLUMNS} FROM evidence_claims c WHERE c.id = ?");
    let row = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(id)
        .fetch_optional(db)
        .await
        .map_err(internal)?
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Claim not found"))?;
    Ok(claim_json(&row))
}

fn text<'a>(input: &'a Value, name: &str) -> &'a str {
    input
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
}

fn valid_reason(reason: &str) -> bool {
    (4..=1200).contains(&reason.chars().count())
}

/// Applies an officer decision to a pending claim: approval awards rubric points,
/// confirmed falsification or tampering imposes a leaderboard sanction.
pub(crate) async fn review_claim(
    db: &SqlitePool,
    officer: &Viewer,
    claim_id: &str,
    input: &Value,
) -> ApiResult<Value> {
    let decision = text(input, "decision");
    let level = input.get("level").and_then(Value::as_str);
    let reason = text(input, "reason");
    let approve = decision == "approve";
    if !matches!(
        decision,
        "approve"
            | "scraper_defect"
            | "reject_unsupported"
            | "confirm_falsification"
            | "confirm_tampering"
    ) {
        return Err(bad("Invalid review decision"));
    }
    if approve && !level.is_some_and(|value| LEVELS.contains(&value)) {
        return Err(bad("Approval requires a verified level"));
    }
    if !approve && !valid_reason(reason) {
        return Err(bad("A review reason is required"));
    }
    if reason.chars().count() > 1200 {
        return Err(bad("Review reason is too long"));
    }
    let mut tx = db.begin().await.map_err(internal)?;
    let claim: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT member_id, source, origin, content_hash FROM evidence_claims WHERE id = ? AND status = 'pending'",
    )
    .bind(claim_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?;
    let (member_id, source, origin, content_hash) =
        claim.ok_or(ApiError(StatusCode::CONFLICT, "Pending claim not found"))?;
    if member_id == officer.id {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Officers cannot review their own evidence",
        ));
    }
    let extension = origin == "extension_scrape";
    if (decision == "scraper_defect" || decision == "confirm_tampering") && !extension {
        return Err(bad("This decision requires extension evidence"));
    }
    if decision == "confirm_falsification" && extension {
        return Err(bad("Falsification decision requires manual evidence"));
    }
    let now = chrono::Utc::now().to_rfc3339();
    let reason_value = (!reason.is_empty()).then_some(reason);
    let mut rubric_version = None;
    if approve {
        let (version, points) = rubric_points(&mut tx, &source, level.unwrap_or_default())
            .await?
            .ok_or(bad("Published rubric level required"))?;
        rubric_version = Some(version);
        sqlx::query("UPDATE evidence_claims SET status='approved', points=?, reviewed_by=?, review_reason=?, reviewed_at=? WHERE id=?")
            .bind(points).bind(&officer.id).bind(reason_value).bind(&now).bind(claim_id)
            .execute(&mut *tx).await.map_err(internal)?;
        sqlx::query("INSERT INTO point_ledger(id,member_id,source_type,source_id,delta,actor_id,reason,created_at) VALUES (?,?,'verified_evidence',?,?,?,'officer_verified',?)")
            .bind(Uuid::new_v4().to_string()).bind(&member_id).bind(claim_id).bind(points)
            .bind(&officer.id).bind(&now)
            .execute(&mut *tx).await.map_err(internal)?;
        sqlx::query("INSERT INTO jobs(id,kind,entity_id,status,available_at,created_at) VALUES (?,'leaderboard_refresh','global','pending',?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET status='pending',generation=jobs.generation+1,available_at=excluded.available_at,result=NULL,finished_at=NULL")
            .bind(Uuid::new_v4().to_string()).bind(&now).bind(&now)
            .execute(&mut *tx).await.map_err(internal)?;
    } else if decision != "scraper_defect" {
        sqlx::query("UPDATE evidence_claims SET status='rejected', points=NULL, reviewed_by=?, review_reason=?, reviewed_at=? WHERE id=?")
            .bind(&officer.id).bind(reason).bind(&now).bind(claim_id)
            .execute(&mut *tx).await.map_err(internal)?;
    }
    if decision == "confirm_falsification" || decision == "confirm_tampering" {
        let violation = if decision == "confirm_tampering" {
            "scraper_tampering"
        } else {
            "manual_falsification"
        };
        sqlx::query("INSERT OR IGNORE INTO leaderboard_sanctions(id,member_id,claim_id,violation_type,safe_reason,imposed_by,imposed_at) VALUES (?,?,?,?,?,?,?)")
            .bind(Uuid::new_v4().to_string()).bind(&member_id).bind(claim_id).bind(violation)
            .bind(reason).bind(&officer.id).bind(&now)
            .execute(&mut *tx).await.map_err(internal)?;
    }
    sqlx::query("INSERT INTO evidence_claim_reviews(id,claim_id,reviewer_id,decision,verified_level,rubric_version,reason,claim_hash,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(claim_id).bind(&officer.id).bind(decision)
        .bind(if approve { level } else { None }).bind(rubric_version).bind(reason_value)
        .bind(&content_hash).bind(&now)
        .execute(&mut *tx).await.map_err(internal)?;
    sqlx::query(
        "INSERT INTO audit_events(id,actor_id,operation,entity_id,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&officer.id)
    .bind(format!("evidence.review.{decision}"))
    .bind(claim_id)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "integrity",
        operation = "review_claim",
        decision,
        "evidence.reviewed"
    );
    one_claim(db, claim_id).await
}

fn appeal_json(row: &SqliteRow, offset: usize) -> Value {
    json!({
        "id": row.get::<String, _>(offset),
        "state": row.get::<String, _>(offset + 1),
        "note": row.get::<String, _>(offset + 2),
        "decisionReason": row.get::<Option<String>, _>(offset + 3),
        "createdAt": row.get::<String, _>(offset + 4),
        "decidedAt": row.get::<Option<String>, _>(offset + 5),
    })
}

/// Active sanctions of the signed-in member with their latest appeal.
pub(crate) async fn member_integrity(db: &SqlitePool, member_id: &str) -> ApiResult<Value> {
    let rows = sqlx::query(
        "SELECT s.id, s.claim_id, s.safe_reason, s.imposed_at, \
                a.id, a.state, a.note, a.decision_reason, a.created_at, a.decided_at \
         FROM leaderboard_sanctions s \
         LEFT JOIN evidence_appeals a ON a.id = (SELECT id FROM evidence_appeals WHERE sanction_id = s.id ORDER BY created_at DESC LIMIT 1) \
         WHERE s.member_id = ? AND s.lifted_at IS NULL ORDER BY s.imposed_at DESC",
    )
    .bind(member_id)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    Ok(Value::Array(
        rows.iter()
            .map(|row| {
                let appeal = row
                    .get::<Option<String>, _>(4)
                    .map(|_| appeal_json(row, 4))
                    .unwrap_or(Value::Null);
                json!({
                    "sanctionId": row.get::<String, _>(0),
                    "claimId": row.get::<String, _>(1),
                    "reason": row.get::<String, _>(2),
                    "imposedAt": row.get::<String, _>(3),
                    "appeal": appeal,
                })
            })
            .collect(),
    ))
}

pub(crate) async fn open_appeal(
    db: &SqlitePool,
    member: &Viewer,
    input: &Value,
) -> ApiResult<Value> {
    let sanction_id = text(input, "sanctionId");
    let note = text(input, "note");
    if !(10..=1200).contains(&note.chars().count()) {
        return Err(bad("An appeal note of 10 to 1200 characters is required"));
    }
    let active: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM leaderboard_sanctions WHERE id = ? AND member_id = ? AND lifted_at IS NULL",
    )
    .bind(sanction_id)
    .bind(&member.id)
    .fetch_optional(db)
    .await
    .map_err(internal)?;
    if active.is_none() {
        return Err(ApiError(StatusCode::NOT_FOUND, "Active sanction not found"));
    }
    let id = Uuid::new_v4().to_string();
    let inserted = sqlx::query(
        "INSERT OR IGNORE INTO evidence_appeals(id,sanction_id,note,created_at) VALUES (?,?,?,?)",
    )
    .bind(&id)
    .bind(sanction_id)
    .bind(note)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(db)
    .await
    .map_err(internal)?
    .rows_affected();
    if inserted == 0 {
        return Err(ApiError(StatusCode::CONFLICT, "An appeal is already open"));
    }
    tracing::info!(
        component = "integrity",
        operation = "open_appeal",
        "evidence.appeal_opened"
    );
    Ok(json!({ "appealId": id }))
}

pub(crate) async fn officer_appeals(db: &SqlitePool) -> ApiResult<Value> {
    let rows = sqlx::query(
        "SELECT s.id, s.claim_id, s.member_id, s.violation_type, \
                a.id, a.state, a.note, a.decision_reason, a.created_at, a.decided_at \
         FROM evidence_appeals a JOIN leaderboard_sanctions s ON s.id = a.sanction_id \
         WHERE a.state = 'open' ORDER BY a.created_at",
    )
    .fetch_all(db)
    .await
    .map_err(internal)?;
    Ok(Value::Array(
        rows.iter()
            .map(|row| {
                let mut appeal = appeal_json(row, 4);
                appeal["sanctionId"] = json!(row.get::<String, _>(0));
                appeal["claimId"] = json!(row.get::<String, _>(1));
                appeal["memberLabel"] = json!(member_label(&row.get::<String, _>(2)));
                appeal["violationType"] = json!(row.get::<String, _>(3));
                appeal
            })
            .collect(),
    ))
}

/// Restoring an appeal lifts the sanction; upholding keeps it.
pub(crate) async fn resolve_appeal(
    db: &SqlitePool,
    officer: &Viewer,
    appeal_id: &str,
    input: &Value,
) -> ApiResult<Value> {
    let decision = text(input, "decision");
    let reason = text(input, "reason");
    if !matches!(decision, "restore" | "uphold") || !valid_reason(reason) {
        return Err(bad("Officer decision and reason required"));
    }
    let mut tx = db.begin().await.map_err(internal)?;
    let appeal: Option<(String, String)> = sqlx::query_as(
        "SELECT a.sanction_id, s.member_id FROM evidence_appeals a JOIN leaderboard_sanctions s ON s.id = a.sanction_id WHERE a.id = ? AND a.state = 'open'",
    )
    .bind(appeal_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?;
    let (sanction_id, member_id) =
        appeal.ok_or(ApiError(StatusCode::NOT_FOUND, "Open appeal not found"))?;
    if member_id == officer.id {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Officers cannot decide their own appeal",
        ));
    }
    let now = chrono::Utc::now().to_rfc3339();
    let state = if decision == "restore" {
        "restored"
    } else {
        "upheld"
    };
    sqlx::query("UPDATE evidence_appeals SET state=?, decided_by=?, decision_reason=?, decided_at=? WHERE id=?")
        .bind(state).bind(&officer.id).bind(reason).bind(&now).bind(appeal_id)
        .execute(&mut *tx).await.map_err(internal)?;
    if decision == "restore" {
        sqlx::query("UPDATE leaderboard_sanctions SET lifted_by=?, lifted_at=? WHERE id=?")
            .bind(&officer.id)
            .bind(&now)
            .bind(&sanction_id)
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
    }
    sqlx::query(
        "INSERT INTO audit_events(id,actor_id,operation,entity_id,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&officer.id)
    .bind(format!("evidence.appeal.{state}"))
    .bind(appeal_id)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "integrity",
        operation = "resolve_appeal",
        state,
        "evidence.appeal_resolved"
    );
    Ok(json!({ "id": appeal_id, "state": state }))
}

/// A member approving their own manual evidence sends it to the officer review queue under
/// the same id. Edits update the claim while it is still pending; reviewed claims are final.
pub(crate) async fn queue_manual_claim(
    db: &SqlitePool,
    member_id: &str,
    claim_id: &str,
    evidence_kind: &str,
    title: &str,
    source_url: &str,
    description: &str,
) -> ApiResult<()> {
    let kind = if evidence_kind == "experience" {
        "external_participation"
    } else {
        "personal_project"
    };
    let hash = hex::encode(Sha256::digest(
        format!(
            "{kind}
{title}
{source_url}
{description}"
        )
        .as_bytes(),
    ));
    let text = (!description.is_empty()).then_some(description);
    let updated = sqlx::query("UPDATE evidence_claims SET kind=?, title=?, source_url=?, submitted_text=?, content_hash=? WHERE id=? AND member_id=? AND status='pending'")
        .bind(kind).bind(title).bind(source_url).bind(text).bind(&hash).bind(claim_id).bind(member_id)
        .execute(db).await.map_err(internal)?.rows_affected();
    if updated == 0 {
        sqlx::query("INSERT OR IGNORE INTO evidence_claims(id,member_id,kind,title,source_url,submitted_text,content_hash,status,created_at) VALUES (?,?,?,?,?,?,?,'pending',?)")
            .bind(claim_id).bind(member_id).bind(kind).bind(title).bind(source_url).bind(text).bind(&hash)
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(db).await.map_err(internal)?;
    }
    tracing::info!(
        component = "integrity",
        operation = "queue_manual_claim",
        updated,
        "evidence.manual_claim_queued"
    );
    Ok(())
}
