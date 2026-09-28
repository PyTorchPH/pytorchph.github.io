use crate::auth;
use crate::{ApiError, ApiResult, AppState, bad, check_origin, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::sync::Arc;
use url::Url;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewClaim {
    kind: String,
    title: String,
    source_url: String,
    content_hash: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionEnvelope {
    schema_version: i64,
    source: String,
    origin: String,
    page_url: String,
    content_hash: String,
    items: Vec<ExtensionItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionItem {
    title: String,
    text: String,
    source_url: String,
    evidence_kind: String,
}

fn source_host_matches(source: &str, host: &str) -> bool {
    match source {
        "github" => host == "github.com",
        "facebook" => host == "facebook.com" || host.ends_with(".facebook.com"),
        "linkedin" => host == "linkedin.com" || host.ends_with(".linkedin.com"),
        _ => false,
    }
}

fn extension_kind(kind: &str, source: &str) -> &'static str {
    match (kind, source) {
        ("project", "github") => "personal_project",
        ("competition", _) => "external_competition",
        ("activity" | "achievement", _) => "external_participation",
        _ => "external_participation",
    }
}

pub async fn submit_extension(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ExtensionEnvelope>,
) -> ApiResult<(StatusCode, Json<serde_json::Value>)> {
    check_origin(&state, &headers)?;
    let actor = auth::viewer(&state, &headers).await?;
    if actor.role == "pending" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Member approval required"));
    }
    let page = Url::parse(&input.page_url).map_err(|_| bad("Invalid extension page"))?;
    if input.schema_version != 1
        || input.origin != "extension_scrape"
        || input.items.is_empty()
        || input.items.len() > 50
        || input.content_hash.len() != 71
        || !input.content_hash.starts_with("sha256:")
        || !input.content_hash[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || page.scheme() != "https"
        || !page
            .host_str()
            .is_some_and(|host| source_host_matches(&input.source, host))
    {
        return Err(bad("Invalid extension envelope"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    let mut submitted = 0;
    let mut duplicates = 0;
    for item in input.items {
        let source_url = Url::parse(&item.source_url).map_err(|_| bad("Invalid evidence URL"))?;
        if item.title.trim().len() < 3
            || item.title.len() > 200
            || item.source_url.len() > 2048
            || item.text.trim().is_empty()
            || item.text.len() > 5000
            || source_url.scheme() != "https"
            || !source_url
                .host_str()
                .is_some_and(|host| source_host_matches(&input.source, host))
            || !matches!(
                item.evidence_kind.as_str(),
                "project" | "achievement" | "competition" | "activity"
            )
        {
            return Err(bad("Invalid extension evidence item"));
        }
        let kind = extension_kind(&item.evidence_kind, &input.source);
        let canonical = serde_json::to_vec(&(
            &input.source,
            kind,
            source_url.as_str(),
            &item.title,
            &item.text,
        ))
        .map_err(internal)?;
        let hash = hex::encode(Sha256::digest(canonical));
        let changed = sqlx::query("INSERT INTO evidence_claims(id,member_id,kind,title,source_url,source,origin,submitted_text,content_hash,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?) ON CONFLICT(member_id,content_hash) DO NOTHING")
            .bind(Uuid::new_v4().to_string()).bind(&actor.id).bind(kind).bind(item.title.trim())
            .bind(source_url.as_str()).bind(&input.source).bind("extension_scrape").bind(&item.text)
            .bind(hash).bind(chrono::Utc::now().to_rfc3339())
            .execute(&mut *tx).await.map_err(internal)?.rows_affected();
        if changed == 1 {
            submitted += 1;
        } else {
            duplicates += 1;
        }
    }
    tx.commit().await.map_err(internal)?;
    tracing::info!(member_id = %actor.id, submitted, duplicates, "evidence.extension_submitted");
    Ok((
        StatusCode::CREATED,
        Json(
            serde_json::json!({"submitted": submitted, "duplicates": duplicates, "status": "pending"}),
        ),
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRef {
    id: String,
    status: &'static str,
}

fn valid_kind(kind: &str) -> bool {
    matches!(
        kind,
        "personal_project" | "external_talk" | "external_competition" | "external_participation"
    )
}

pub async fn submit_claim(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<NewClaim>,
) -> ApiResult<(StatusCode, Json<ClaimRef>)> {
    check_origin(&state, &headers)?;
    let actor = auth::viewer(&state, &headers).await?;
    if actor.role == "pending" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Member approval required"));
    }
    let url = Url::parse(&input.source_url).map_err(|_| bad("Invalid evidence URL"))?;
    if !valid_kind(&input.kind)
        || input.title.trim().len() < 3
        || input.title.len() > 200
        || input.source_url.len() > 2048
        || !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || input.content_hash.len() != 64
        || !input
            .content_hash
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err(bad("Invalid evidence claim"));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO evidence_claims(id,member_id,kind,title,source_url,content_hash,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)")
        .bind(&id).bind(&actor.id).bind(&input.kind).bind(input.title.trim()).bind(&input.source_url)
        .bind(input.content_hash.to_ascii_lowercase()).bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db).await.map_err(|error| {
            if error.as_database_error().is_some_and(|db| db.is_unique_violation()) { bad("Evidence already submitted") } else { internal(error) }
        })?;
    Ok((
        StatusCode::CREATED,
        Json(ClaimRef {
            id,
            status: "pending",
        }),
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimView {
    id: String,
    member_id: String,
    kind: String,
    title: String,
    source_url: String,
    source: String,
    origin: String,
    submitted_text: Option<String>,
    status: String,
    points: Option<i64>,
}

async fn claims(state: &AppState, owner: Option<&str>) -> ApiResult<Vec<ClaimView>> {
    let rows = if let Some(owner) = owner {
        sqlx::query("SELECT id,member_id,kind,title,source_url,source,origin,submitted_text,status,points FROM evidence_claims WHERE member_id=? ORDER BY created_at DESC LIMIT 100")
            .bind(owner).fetch_all(&state.db).await.map_err(internal)?
    } else {
        sqlx::query("SELECT id,member_id,kind,title,source_url,source,origin,submitted_text,status,points FROM evidence_claims WHERE status='pending' ORDER BY created_at LIMIT 100")
            .fetch_all(&state.db).await.map_err(internal)?
    };
    Ok(rows
        .into_iter()
        .map(|row| ClaimView {
            id: row.get(0),
            member_id: row.get(1),
            kind: row.get(2),
            title: row.get(3),
            source_url: row.get(4),
            source: row.get(5),
            origin: row.get(6),
            submitted_text: row.get(7),
            status: row.get(8),
            points: row.get(9),
        })
        .collect())
}

pub async fn my_claims(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<ClaimView>>> {
    let actor = auth::viewer(&state, &headers).await?;
    Ok(Json(claims(&state, Some(&actor.id)).await?))
}

pub async fn pending_claims(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<ClaimView>>> {
    let _ = auth::require_officer(&state, &headers).await?;
    Ok(Json(claims(&state, None).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Review {
    decision: String,
    points: Option<i64>,
    reason: String,
}

pub async fn review_claim(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<Review>,
) -> ApiResult<StatusCode> {
    check_origin(&state, &headers)?;
    let officer = auth::require_officer(&state, &headers).await?;
    if !matches!(input.decision.as_str(), "approve" | "reject")
        || input.reason.trim().len() < 4
        || input.reason.len() > 500
        || (input.decision == "approve"
            && !input
                .points
                .is_some_and(|points| (1..=1000).contains(&points)))
        || (input.decision == "reject" && input.points.is_some())
    {
        return Err(bad("Invalid evidence review"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    let owner: Option<(String,)> =
        sqlx::query_as("SELECT member_id FROM evidence_claims WHERE id=? AND status='pending'")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(internal)?;
    let Some((member_id,)) = owner else {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "Claim is not pending",
        ));
    };
    if member_id == officer.id {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Cannot review own evidence",
        ));
    }
    let status = if input.decision == "approve" {
        "approved"
    } else {
        "rejected"
    };
    let now = chrono::Utc::now().to_rfc3339();
    let changed = sqlx::query("UPDATE evidence_claims SET status=?,points=?,reviewed_by=?,review_reason=?,reviewed_at=? WHERE id=? AND status='pending'")
        .bind(status).bind(input.points).bind(&officer.id).bind(input.reason.trim()).bind(&now).bind(&id)
        .execute(&mut *tx).await.map_err(internal)?.rows_affected();
    if changed != 1 {
        return Err(ApiError(StatusCode::PRECONDITION_FAILED, "Claim changed"));
    }
    if let Some(points) = input.points {
        sqlx::query("INSERT INTO point_ledger(id,member_id,source_type,source_id,delta,actor_id,reason,created_at) VALUES (?,?, 'verified_evidence', ?,?,?,?,?)")
            .bind(Uuid::new_v4().to_string()).bind(&member_id).bind(&id).bind(points)
            .bind(&officer.id).bind("officer_verified").bind(&now).execute(&mut *tx).await.map_err(internal)?;
        sqlx::query("INSERT INTO jobs(id,kind,entity_id,status,available_at,created_at) VALUES (?,'leaderboard_refresh',?,'pending',?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET status='pending',generation=jobs.generation+1,available_at=excluded.available_at,result=NULL,finished_at=NULL")
            .bind(Uuid::new_v4().to_string()).bind("global").bind(&now).bind(&now).execute(&mut *tx).await.map_err(internal)?;
    }
    sqlx::query(
        "INSERT INTO audit_events(id,actor_id,operation,entity_id,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&officer.id)
    .bind(format!("evidence.{status}"))
    .bind(&id)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}
