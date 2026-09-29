//! A member approving their own portfolio item sends it to officer review.
//!
//! Module map (caller-first):
//!   queue_manual_claim          update the pending claim, or create it under the item's id
//!   ├─ claim_kind_for           portfolio kind → claim kind
//!   ├─ manual_content_hash      fingerprint of the submitted content
//!   ├─ update_pending_claim     edits apply only while the claim is still pending
//!   └─ insert_pending_claim     first approval creates the claim
use crate::{ApiResult, internal};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

/// A member approving their own manual evidence sends it to the officer review queue under
/// the same id. Edits update the claim while it is still pending; reviewed claims are final.
// Mental model: the portfolio item and its claim share one id, so an approval either updates
// the claim still waiting for review or creates it; a reviewed claim is never rewritten.
pub(crate) async fn queue_manual_claim(
    db: &SqlitePool,
    member_id: &str,
    claim_id: &str,
    evidence_kind: &str,
    title: &str,
    source_url: &str,
    description: &str,
) -> ApiResult<()> {
    let claim = ManualClaim {
        id: claim_id,
        member_id,
        kind: claim_kind_for(evidence_kind),
        title,
        source_url,
        text: non_empty(description),
        content_hash: manual_content_hash(
            claim_kind_for(evidence_kind),
            title,
            source_url,
            description,
        ),
    };
    let updated = update_pending_claim(db, &claim).await?;
    if updated == 0 {
        insert_pending_claim(db, &claim).await?;
    }
    tracing::info!(
        component = "integrity",
        operation = "queue_manual_claim",
        updated,
        "evidence.manual_claim_queued"
    );
    Ok(())
}

struct ManualClaim<'a> {
    id: &'a str,
    member_id: &'a str,
    kind: &'static str,
    title: &'a str,
    source_url: &'a str,
    text: Option<&'a str>,
    content_hash: String,
}

#[inline]
fn claim_kind_for(evidence_kind: &str) -> &'static str {
    if evidence_kind == "experience" {
        "external_participation"
    } else {
        "personal_project"
    }
}

#[inline]
fn non_empty(text: &str) -> Option<&str> {
    (!text.is_empty()).then_some(text)
}

fn manual_content_hash(kind: &str, title: &str, source_url: &str, description: &str) -> String {
    hex::encode(Sha256::digest(
        format!("{kind}\n{title}\n{source_url}\n{description}").as_bytes(),
    ))
}

async fn update_pending_claim(db: &SqlitePool, claim: &ManualClaim<'_>) -> ApiResult<u64> {
    Ok(sqlx::query("UPDATE evidence_claims SET kind=?, title=?, source_url=?, submitted_text=?, content_hash=? WHERE id=? AND member_id=? AND status='pending'")
        .bind(claim.kind).bind(claim.title).bind(claim.source_url).bind(claim.text).bind(&claim.content_hash).bind(claim.id).bind(claim.member_id)
        .execute(db).await.map_err(internal)?.rows_affected())
}

async fn insert_pending_claim(db: &SqlitePool, claim: &ManualClaim<'_>) -> ApiResult<()> {
    sqlx::query("INSERT OR IGNORE INTO evidence_claims(id,member_id,kind,title,source_url,submitted_text,content_hash,status,created_at) VALUES (?,?,?,?,?,?,?,'pending',?)")
        .bind(claim.id).bind(claim.member_id).bind(claim.kind).bind(claim.title).bind(claim.source_url).bind(claim.text).bind(&claim.content_hash)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(db).await.map_err(internal)?;
    Ok(())
}
