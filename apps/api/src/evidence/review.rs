//! Officer review of one pending evidence claim, scored with the published rubric.
//!
//! Module map (caller-first):
//!   review_claim                  one review inside a transaction, then the updated claim
//!   ├─ parse_review               decision, verified level and reason from the request
//!   │   └─ Decision::parse
//!   ├─ load_pending_claim         the claim that is still waiting for review
//!   ├─ ensure_may_decide          no self-review; the decision must fit the claim's origin
//!   │   └─ ensure_decision_fits_origin
//!   ├─ apply_decision             approve → points · reject → close · confirm → close + sanction
//!   │   ├─ award_rubric_points
//!   │   │   ├─ mark_claim_approved
//!   │   │   ├─ credit_verified_points
//!   │   │   └─ queue_leaderboard_refresh
//!   │   ├─ close_claim
//!   │   └─ sanctions::impose_sanction
//!   └─ record_review              review history row and audit event
//!       ├─ insert_review_row
//!       └─ insert_audit_event
use super::{
    claim_view,
    request_fields::{is_valid_reason, trimmed_text},
    rubric, sanctions,
};
use crate::{ApiError, ApiResult, bad, identity::session::Viewer, internal};
use axum::http::StatusCode;
use serde_json::Value;
use sqlx::{SqliteConnection, SqlitePool};
use uuid::Uuid;

const MAX_REASON_CHARS: usize = 1200;
const EXTENSION_ORIGIN: &str = "extension_scrape";

/// The integrity violation an officer confirms.
#[derive(Clone, Copy)]
pub(crate) enum Violation {
    ManualFalsification,
    ScraperTampering,
}

impl Violation {
    #[inline]
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::ManualFalsification => "manual_falsification",
            Self::ScraperTampering => "scraper_tampering",
        }
    }
}

#[derive(Clone, Copy)]
enum Decision<'a> {
    Approve { level: &'a str },
    ScraperDefect,
    RejectUnsupported,
    Confirm(Violation),
}

impl<'a> Decision<'a> {
    fn parse(name: &str, level: Option<&'a str>) -> ApiResult<Self> {
        match name {
            "approve" => match level.filter(|value| rubric::is_rubric_level(value)) {
                Some(level) => Ok(Self::Approve { level }),
                None => Err(bad("Approval requires a verified level")),
            },
            "scraper_defect" => Ok(Self::ScraperDefect),
            "reject_unsupported" => Ok(Self::RejectUnsupported),
            "confirm_falsification" => Ok(Self::Confirm(Violation::ManualFalsification)),
            "confirm_tampering" => Ok(Self::Confirm(Violation::ScraperTampering)),
            _ => Err(bad("Invalid review decision")),
        }
    }

    #[inline]
    fn name(self) -> &'static str {
        match self {
            Self::Approve { .. } => "approve",
            Self::ScraperDefect => "scraper_defect",
            Self::RejectUnsupported => "reject_unsupported",
            Self::Confirm(Violation::ManualFalsification) => "confirm_falsification",
            Self::Confirm(Violation::ScraperTampering) => "confirm_tampering",
        }
    }

    #[inline]
    fn is_approval(self) -> bool {
        matches!(self, Self::Approve { .. })
    }

    #[inline]
    fn verified_level(self) -> Option<&'a str> {
        match self {
            Self::Approve { level } => Some(level),
            _ => None,
        }
    }

    #[inline]
    fn needs_extension_evidence(self) -> bool {
        matches!(
            self,
            Self::ScraperDefect | Self::Confirm(Violation::ScraperTampering)
        )
    }

    #[inline]
    fn needs_manual_evidence(self) -> bool {
        matches!(self, Self::Confirm(Violation::ManualFalsification))
    }
}

struct Review<'a> {
    decision: Decision<'a>,
    reason: &'a str,
}

impl<'a> Review<'a> {
    /// An empty reason is stored as NULL.
    #[inline]
    fn stored_reason(&self) -> Option<&'a str> {
        (!self.reason.is_empty()).then_some(self.reason)
    }
}

struct PendingClaim<'a> {
    id: &'a str,
    member_id: String,
    source: String,
    origin: String,
    content_hash: String,
}

impl PendingClaim<'_> {
    #[inline]
    fn is_from_extension(&self) -> bool {
        self.origin == EXTENSION_ORIGIN
    }
}

/// Applies an officer decision to a pending claim: approval awards rubric points,
/// confirmed falsification or tampering imposes a leaderboard sanction.
// Mental model: validate the request before touching the database; then, inside one
// transaction, lock the still-pending claim, apply the decision's effects, and record who
// decided what. The response is the claim as the review queue now shows it.
pub(crate) async fn review_claim(
    db: &SqlitePool,
    officer: &Viewer,
    claim_id: &str,
    input: &Value,
) -> ApiResult<Value> {
    let review = parse_review(input)?;
    let mut tx = db.begin().await.map_err(internal)?;
    let claim = load_pending_claim(&mut tx, claim_id).await?;
    ensure_may_decide(officer, &claim, review.decision)?;
    let now = chrono::Utc::now().to_rfc3339();
    let rubric_version = apply_decision(&mut tx, officer, &claim, &review, &now).await?;
    record_review(&mut tx, officer, &claim, &review, rubric_version, &now).await?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "integrity",
        operation = "review_claim",
        decision = review.decision.name(),
        "evidence.reviewed"
    );
    claim_view::one_claim(db, claim_id).await
}

fn parse_review(input: &Value) -> ApiResult<Review<'_>> {
    let decision = Decision::parse(
        trimmed_text(input, "decision"),
        input.get("level").and_then(Value::as_str),
    )?;
    let reason = trimmed_text(input, "reason");
    if !decision.is_approval() && !is_valid_reason(reason) {
        return Err(bad("A review reason is required"));
    }
    if exceeds_reason_limit(reason) {
        return Err(bad("Review reason is too long"));
    }
    Ok(Review { decision, reason })
}

#[inline]
fn exceeds_reason_limit(reason: &str) -> bool {
    reason.chars().count() > MAX_REASON_CHARS
}

async fn load_pending_claim<'a>(
    conn: &mut SqliteConnection,
    claim_id: &'a str,
) -> ApiResult<PendingClaim<'a>> {
    let claim: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT member_id, source, origin, content_hash FROM evidence_claims WHERE id = ? AND status = 'pending'",
    )
    .bind(claim_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(internal)?;
    let (member_id, source, origin, content_hash) =
        claim.ok_or(ApiError(StatusCode::CONFLICT, "Pending claim not found"))?;
    Ok(PendingClaim {
        id: claim_id,
        member_id,
        source,
        origin,
        content_hash,
    })
}

fn ensure_may_decide(officer: &Viewer, claim: &PendingClaim, decision: Decision) -> ApiResult<()> {
    if is_own_claim(officer, claim) {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Officers cannot review their own evidence",
        ));
    }
    ensure_decision_fits_origin(decision, claim)
}

#[inline]
fn is_own_claim(officer: &Viewer, claim: &PendingClaim) -> bool {
    claim.member_id == officer.id
}

// Scraper defects and tampering only make sense for extension evidence; falsification only
// for evidence the member typed in.
fn ensure_decision_fits_origin(decision: Decision, claim: &PendingClaim) -> ApiResult<()> {
    if decision.needs_extension_evidence() && !claim.is_from_extension() {
        return Err(bad("This decision requires extension evidence"));
    }
    if decision.needs_manual_evidence() && claim.is_from_extension() {
        return Err(bad("Falsification decision requires manual evidence"));
    }
    Ok(())
}

/// Returns the rubric version used when the claim was approved.
async fn apply_decision(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    claim: &PendingClaim<'_>,
    review: &Review<'_>,
    now: &str,
) -> ApiResult<Option<i64>> {
    match review.decision {
        Decision::Approve { level } => {
            award_rubric_points(conn, officer, claim, level, review.stored_reason(), now)
                .await
                .map(Some)
        }
        // A scraper defect keeps the claim pending; the review row marks it disputed.
        Decision::ScraperDefect => Ok(None),
        Decision::RejectUnsupported => {
            close_claim(conn, officer, claim.id, review.reason, now).await?;
            Ok(None)
        }
        Decision::Confirm(violation) => {
            close_claim(conn, officer, claim.id, review.reason, now).await?;
            sanctions::impose_sanction(
                conn,
                officer,
                &claim.member_id,
                claim.id,
                violation,
                review.reason,
                now,
            )
            .await?;
            Ok(None)
        }
    }
}

// Mental model: look up what the verified level is worth, mark the claim approved with
// those points, credit the ledger, and ask the worker to refresh the leaderboard.
async fn award_rubric_points(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    claim: &PendingClaim<'_>,
    level: &str,
    reason: Option<&str>,
    now: &str,
) -> ApiResult<i64> {
    let (version, points) = rubric::rubric_points(conn, &claim.source, level)
        .await?
        .ok_or(bad("Published rubric level required"))?;
    mark_claim_approved(conn, officer, claim.id, points, reason, now).await?;
    credit_verified_points(conn, officer, claim, points, now).await?;
    queue_leaderboard_refresh(conn, now).await?;
    Ok(version)
}

async fn mark_claim_approved(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    claim_id: &str,
    points: i64,
    reason: Option<&str>,
    now: &str,
) -> ApiResult<()> {
    sqlx::query("UPDATE evidence_claims SET status='approved', points=?, reviewed_by=?, review_reason=?, reviewed_at=? WHERE id=?")
        .bind(points).bind(&officer.id).bind(reason).bind(now).bind(claim_id)
        .execute(&mut *conn).await.map_err(internal)?;
    Ok(())
}

async fn credit_verified_points(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    claim: &PendingClaim<'_>,
    points: i64,
    now: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO point_ledger(id,member_id,source_type,source_id,delta,actor_id,reason,created_at) VALUES (?,?,'verified_evidence',?,?,?,'officer_verified',?)")
        .bind(Uuid::new_v4().to_string()).bind(&claim.member_id).bind(claim.id).bind(points)
        .bind(&officer.id).bind(now)
        .execute(&mut *conn).await.map_err(internal)?;
    Ok(())
}

async fn queue_leaderboard_refresh(conn: &mut SqliteConnection, now: &str) -> ApiResult<()> {
    sqlx::query("INSERT INTO jobs(id,kind,entity_id,status,available_at,created_at) VALUES (?,'leaderboard_refresh','global','pending',?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET status='pending',generation=jobs.generation+1,available_at=excluded.available_at,result=NULL,finished_at=NULL")
        .bind(Uuid::new_v4().to_string()).bind(now).bind(now)
        .execute(&mut *conn).await.map_err(internal)?;
    Ok(())
}

async fn close_claim(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    claim_id: &str,
    reason: &str,
    now: &str,
) -> ApiResult<()> {
    sqlx::query("UPDATE evidence_claims SET status='rejected', points=NULL, reviewed_by=?, review_reason=?, reviewed_at=? WHERE id=?")
        .bind(&officer.id).bind(reason).bind(now).bind(claim_id)
        .execute(&mut *conn).await.map_err(internal)?;
    Ok(())
}

async fn record_review(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    claim: &PendingClaim<'_>,
    review: &Review<'_>,
    rubric_version: Option<i64>,
    now: &str,
) -> ApiResult<()> {
    insert_review_row(conn, officer, claim, review, rubric_version, now).await?;
    insert_audit_event(conn, officer, claim.id, review.decision, now).await
}

async fn insert_review_row(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    claim: &PendingClaim<'_>,
    review: &Review<'_>,
    rubric_version: Option<i64>,
    now: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO evidence_claim_reviews(id,claim_id,reviewer_id,decision,verified_level,rubric_version,reason,claim_hash,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(claim.id).bind(&officer.id).bind(review.decision.name())
        .bind(review.decision.verified_level()).bind(rubric_version).bind(review.stored_reason())
        .bind(&claim.content_hash).bind(now)
        .execute(&mut *conn).await.map_err(internal)?;
    Ok(())
}

async fn insert_audit_event(
    conn: &mut SqliteConnection,
    officer: &Viewer,
    claim_id: &str,
    decision: Decision<'_>,
    now: &str,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO audit_events(id,actor_id,operation,entity_id,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&officer.id)
    .bind(format!("evidence.review.{}", decision.name()))
    .bind(claim_id)
    .bind(now)
    .execute(&mut *conn)
    .await
    .map_err(internal)?;
    Ok(())
}
