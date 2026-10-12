//! Canonical skills shared by evidence, events, leaderboards, and client-side matching.
//! AI may suggest labels in the browser, but this module alone resolves and mutates catalog data.
use crate::{ApiError, ApiResult, bad, identity::session::Viewer, internal};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::{Row, SqliteConnection, SqlitePool};
use uuid::Uuid;

use super::raw_skills::normalize_raw;

pub(crate) async fn skill_catalog(db: &SqlitePool) -> ApiResult<Value> {
    let rows = sqlx::query(
        "SELECT s.slug,s.label,s.category,COUNT(a.alias) aliases \
         FROM skills s LEFT JOIN skill_aliases a ON a.skill_slug=s.slug \
         WHERE s.status='active' GROUP BY s.slug,s.label,s.category ORDER BY s.category,s.label",
    )
    .fetch_all(db)
    .await
    .map_err(internal)?;
    let version: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(rowid),0) FROM skills")
        .fetch_one(db)
        .await
        .map_err(internal)?;
    Ok(json!({
        "catalogVersion": version,
        "skills": rows.into_iter().map(|row| json!({
            "slug": row.get::<String,_>(0), "label": row.get::<String,_>(1),
            "category": row.get::<String,_>(2), "aliasCount": row.get::<i64,_>(3),
        })).collect::<Vec<_>>(),
    }))
}

pub(crate) async fn sync_claim_skills(
    db: &SqlitePool,
    claim_id: &str,
    member_id: &str,
    skills: &[String],
) -> ApiResult<()> {
    let mut tx = db.begin().await.map_err(internal)?;
    sqlx::query("DELETE FROM evidence_claim_skills WHERE claim_id=?")
        .bind(claim_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    for (ord, raw) in skills.iter().enumerate() {
        let normalized = normalize_raw(raw);
        if normalized.is_empty() || normalized.chars().count() > 80 {
            continue;
        }
        if let Some(slug) = resolve_alias(&mut tx, &normalized).await? {
            sqlx::query("INSERT INTO evidence_claim_skills(claim_id,ord,raw,skill_slug,state) VALUES (?,?,?,?,'matched')")
                .bind(claim_id).bind(ord as i64).bind(raw.trim()).bind(slug)
                .execute(&mut *tx).await.map_err(internal)?;
        } else {
            let candidate_id =
                ensure_candidate(&mut tx, raw, &normalized, member_id, claim_id).await?;
            sqlx::query("INSERT INTO evidence_claim_skills(claim_id,ord,raw,candidate_id,state) VALUES (?,?,?,?,'pending')")
                .bind(claim_id).bind(ord as i64).bind(raw.trim()).bind(candidate_id)
                .execute(&mut *tx).await.map_err(internal)?;
        }
    }
    tx.commit().await.map_err(internal)
}

pub(crate) async fn credit_claim_skills(
    conn: &mut SqliteConnection,
    claim_id: &str,
    member_id: &str,
    officer_id: &str,
    now: &str,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT OR IGNORE INTO member_skills(member_id,skill_slug,verified_by,verified_at) \
         SELECT ?,skill_slug,?,? FROM evidence_claim_skills WHERE claim_id=? AND state='matched' AND skill_slug IS NOT NULL",
    ).bind(member_id).bind(officer_id).bind(now).bind(claim_id)
        .execute(conn).await.map_err(internal)?;
    Ok(())
}

pub(crate) async fn pending_candidates(db: &SqlitePool, actor: &Viewer) -> ApiResult<Value> {
    require_reviewer(actor)?;
    let rows = sqlx::query(
        "SELECT c.id,c.raw,c.suggested_category,c.source_kind,c.source_id,c.created_at,COUNT(e.claim_id) \
         FROM skill_candidates c LEFT JOIN evidence_claim_skills e ON e.candidate_id=c.id \
         WHERE c.state='pending' GROUP BY c.id ORDER BY c.created_at",
    ).fetch_all(db).await.map_err(internal)?;
    Ok(Value::Array(
        rows.into_iter()
            .map(|row| {
                json!({
                    "id":row.get::<String,_>(0), "raw":row.get::<String,_>(1),
                    "suggestedCategory":row.get::<String,_>(2), "sourceKind":row.get::<String,_>(3),
                    "sourceId":row.get::<Option<String>,_>(4), "createdAt":row.get::<String,_>(5),
                    "claimCount":row.get::<i64,_>(6),
                })
            })
            .collect(),
    ))
}

pub(crate) async fn review_candidate(
    db: &SqlitePool,
    actor: &Viewer,
    candidate_id: &str,
    input: &Value,
) -> ApiResult<Value> {
    require_reviewer(actor)?;
    let decision = input.get("decision").and_then(Value::as_str).unwrap_or("");
    let reason = bounded(input.get("reason"), 1200).unwrap_or_default();
    let mut tx = db.begin().await.map_err(internal)?;
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT raw,normalized FROM skill_candidates WHERE id=? AND state='pending'",
    )
    .bind(candidate_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?;
    let (raw, normalized) =
        row.ok_or(ApiError(StatusCode::NOT_FOUND, "Pending skill not found"))?;
    let now = chrono::Utc::now().to_rfc3339();
    let mapped = match decision {
        "approve" => {
            let label = bounded(input.get("label"), 80).unwrap_or_else(|| raw.clone());
            let category = bounded(input.get("category"), 80).unwrap_or_else(|| "Other".to_owned());
            let slug = unique_slug(&mut tx, &label).await?;
            sqlx::query("INSERT INTO skills(slug,label,category,status,created_by,created_at) VALUES (?,?,?,'active',?,?)")
                .bind(&slug).bind(&label).bind(&category).bind(&actor.id).bind(&now)
                .execute(&mut *tx).await.map_err(internal)?;
            Some(slug)
        }
        "map" => {
            let slug = bounded(input.get("skillSlug"), 40)
                .ok_or_else(|| bad("Choose an existing skill"))?;
            let exists: Option<(String,)> =
                sqlx::query_as("SELECT slug FROM skills WHERE slug=? AND status='active'")
                    .bind(&slug)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(internal)?;
            Some(exists.ok_or_else(|| bad("Choose an active skill"))?.0)
        }
        "reject" if reason.chars().count() >= 4 => None,
        "reject" => return Err(bad("A rejection reason is required")),
        _ => return Err(bad("Invalid skill review decision")),
    };
    if let Some(slug) = mapped.as_deref() {
        sqlx::query("INSERT INTO skill_aliases(alias,skill_slug,created_by,created_at) VALUES (?,?,?,?) ON CONFLICT(alias) DO UPDATE SET skill_slug=excluded.skill_slug")
            .bind(&normalized).bind(slug).bind(&actor.id).bind(&now)
            .execute(&mut *tx).await.map_err(internal)?;
        sqlx::query(
            "UPDATE evidence_claim_skills SET skill_slug=?,state='matched' WHERE candidate_id=?",
        )
        .bind(slug)
        .bind(candidate_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
        sqlx::query(
            "INSERT OR IGNORE INTO member_skills(member_id,skill_slug,verified_by,verified_at) \
             SELECT c.member_id,?, ?,? FROM evidence_claim_skills e JOIN evidence_claims c ON c.id=e.claim_id \
             WHERE e.candidate_id=? AND c.status='approved'",
        ).bind(slug).bind(&actor.id).bind(&now).bind(candidate_id)
            .execute(&mut *tx).await.map_err(internal)?;
    } else {
        sqlx::query("UPDATE evidence_claim_skills SET state='rejected' WHERE candidate_id=?")
            .bind(candidate_id)
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
    }
    sqlx::query("UPDATE skill_candidates SET state=?,mapped_skill_slug=?,reviewed_by=?,review_reason=?,reviewed_at=? WHERE id=?")
        .bind(if decision=="approve" {"approved"} else if decision=="map" {"mapped"} else {"rejected"})
        .bind(mapped.as_deref()).bind(&actor.id).bind(if reason.is_empty(){None}else{Some(reason.as_str())}).bind(&now).bind(candidate_id)
        .execute(&mut *tx).await.map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "skill_taxonomy",
        operation = "review_candidate",
        candidate_id,
        decision,
        mapped_skill = mapped.as_deref().unwrap_or(""),
        "skill_taxonomy.candidate_reviewed"
    );
    Ok(json!({"id":candidate_id,"decision":decision,"skillSlug":mapped}))
}

async fn resolve_alias(conn: &mut SqliteConnection, normalized: &str) -> ApiResult<Option<String>> {
    sqlx::query_scalar(
        "SELECT a.skill_slug FROM skill_aliases a JOIN skills s ON s.slug=a.skill_slug WHERE a.alias=? AND s.status='active'",
    ).bind(normalized).fetch_optional(conn).await.map_err(internal)
}

async fn ensure_candidate(
    conn: &mut SqliteConnection,
    raw: &str,
    normalized: &str,
    member_id: &str,
    source_id: &str,
) -> ApiResult<String> {
    if let Some(id) = sqlx::query_scalar::<_, String>(
        "SELECT id FROM skill_candidates WHERE normalized=? AND state='pending'",
    )
    .bind(normalized)
    .fetch_optional(&mut *conn)
    .await
    .map_err(internal)?
    {
        return Ok(id);
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO skill_candidates(id,raw,normalized,source_kind,source_id,submitted_by,created_at) VALUES (?,?,?,'evidence',?,?,?)")
        .bind(&id).bind(raw.trim()).bind(normalized).bind(source_id).bind(member_id).bind(chrono::Utc::now().to_rfc3339())
        .execute(conn).await.map_err(internal)?;
    Ok(id)
}

async fn unique_slug(conn: &mut SqliteConnection, label: &str) -> ApiResult<String> {
    let base: String = label
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let base = if base.is_empty() {
        "skill".to_owned()
    } else {
        base.chars().take(34).collect()
    };
    for suffix in 0..100 {
        let slug = if suffix == 0 {
            base.clone()
        } else {
            format!("{base}-{suffix}")
        };
        let exists: Option<(String,)> = sqlx::query_as("SELECT slug FROM skills WHERE slug=?")
            .bind(&slug)
            .fetch_optional(&mut *conn)
            .await
            .map_err(internal)?;
        if exists.is_none() {
            return Ok(slug);
        }
    }
    Ok(format!(
        "skill-{}",
        &Uuid::new_v4().simple().to_string()[..8]
    ))
}

fn require_reviewer(actor: &Viewer) -> ApiResult<()> {
    if matches!(actor.role.as_str(), "officer" | "admin") {
        Ok(())
    } else {
        Err(ApiError(
            StatusCode::FORBIDDEN,
            "Evidence review access required",
        ))
    }
}

fn bounded(value: Option<&Value>, max: usize) -> Option<String> {
    let text = value?
        .as_str()?
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!text.is_empty() && text.chars().count() <= max).then_some(text)
}
