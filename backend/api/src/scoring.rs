//! One scoring policy: positive awards, saved event weights, and blind pairwise reviews.
use crate::{ApiError, ApiResult, AppState, bad, check_origin, identity::session, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Sha256;
use sqlx::{Row, SqliteConnection, SqlitePool};
use std::sync::Arc;
use uuid::Uuid;

pub(crate) mod scheduler;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NewComparison {
    skill_slug: String,
    member_a: String,
    member_b: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ValidatorAssignment {
    member_id: String,
    skill_slug: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Vote {
    pub(crate) outcome: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SuggestionRequest {
    category: String,
    skill_tags: Vec<crate::events::EventSkillTag>,
}

pub(crate) async fn skills(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    session::require_officer(&state, &headers).await?;
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT slug,label FROM skills ORDER BY label")
            .fetch_all(&state.db)
            .await
            .map_err(internal)?;
    Ok(Json(json!(
        rows.into_iter()
            .map(|(slug, label)| json!({"slug":slug,"label":label}))
            .collect::<Vec<_>>()
    )))
}

pub(crate) async fn season_progress(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    session::require_officer(&state, &headers).await?;
    let (season, cutoff) = scheduler::completed_quarter();
    let skills: Vec<(String, String)> =
        sqlx::query_as("SELECT slug,label FROM skills ORDER BY label")
            .fetch_all(&state.db)
            .await
            .map_err(internal)?;
    let mut rows = Vec::new();
    for (slug, label) in skills {
        let candidates: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM members m WHERE m.role!='pending' AND (EXISTS (SELECT 1 FROM point_awards p JOIN event_skill_tags t ON t.event_id=p.event_id WHERE p.member_id=m.id AND t.skill_slug=? AND p.created_at<=?) OR EXISTS (SELECT 1 FROM member_skills s JOIN evidence_claims c ON c.member_id=s.member_id AND c.kind='personal_project' AND c.status='approved' WHERE s.member_id=m.id AND s.skill_slug=? AND s.verified_at<=? AND c.reviewed_at<=?))",
        ).bind(&slug).bind(&cutoff).bind(&slug).bind(&cutoff).bind(&cutoff).fetch_one(&state.db).await.map_err(internal)?;
        if candidates == 0 {
            continue;
        }
        let scheduled: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM skill_comparisons WHERE season_slug=? AND skill_slug=?",
        )
        .bind(&season)
        .bind(&slug)
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;
        let reviewed: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM skill_comparisons c WHERE c.season_slug=? AND c.skill_slug=? AND (SELECT COUNT(*) FROM skill_comparison_votes v WHERE v.comparison_id=c.id)>=3",
        ).bind(&season).bind(&slug).fetch_one(&state.db).await.map_err(internal)?;
        rows.push(json!({"slug":slug,"label":label,"candidates":candidates,
            "totalPairs":candidates * (candidates - 1) / 2,"scheduled":scheduled,"reviewed":reviewed}));
    }
    Ok(Json(json!({"season":season,"cutoff":cutoff,"skills":rows})))
}

pub(crate) async fn suggested_weight(
    conn: &mut SqliteConnection,
    category: &str,
    tags: &[(String, i64)],
) -> ApiResult<Option<(i64, i64)>> {
    let row: Option<(i64, String)> = sqlx::query_as(
        "SELECT version,coefficients_json FROM scoring_model_versions ORDER BY version DESC LIMIT 1"
    ).fetch_optional(&mut *conn).await.map_err(internal)?;
    let Some((version, encoded)) = row else {
        return Ok(None);
    };
    let coefficients: Value = serde_json::from_str(&encoded).map_err(internal)?;
    let mut weighted = 0_i64;
    for (skill, allocation) in tags {
        let Some(weight) = coefficients[skill][category].as_i64() else {
            return Ok(None);
        };
        weighted += weight * allocation;
    }
    Ok(Some((version, (weighted + 5000) / 10000)))
}

pub(crate) async fn proposed_place_points(
    conn: &mut SqliteConnection,
    version: i64,
    category: &str,
) -> ApiResult<Option<Vec<i64>>> {
    let encoded: String =
        sqlx::query_scalar("SELECT place_points_json FROM scoring_model_versions WHERE version=?")
            .bind(version)
            .fetch_one(conn)
            .await
            .map_err(internal)?;
    let schedules: Value = serde_json::from_str(&encoded).map_err(internal)?;
    let Some(points) = schedules.get(category).and_then(Value::as_array) else {
        return Ok(None);
    };
    let parsed: Option<Vec<i64>> = points.iter().map(Value::as_i64).collect();
    Ok(parsed.filter(|values| {
        !values.is_empty()
            && values.len() <= 100
            && values.iter().all(|value| *value >= 0)
            && values.windows(2).all(|pair| pair[0] >= pair[1])
    }))
}

pub(crate) async fn suggest_for_event(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<SuggestionRequest>,
) -> ApiResult<Json<Value>> {
    check_origin(&state, &headers)?;
    session::require_officer(&state, &headers).await?;
    if input.skill_tags.is_empty()
        || input
            .skill_tags
            .iter()
            .map(|tag| tag.allocation_bps)
            .sum::<i64>()
            != 10000
    {
        return Err(bad("Skill allocations must total 10000"));
    }
    let tags = input
        .skill_tags
        .iter()
        .map(|tag| (tag.skill_slug.clone(), tag.allocation_bps))
        .collect::<Vec<_>>();
    let mut conn = state.db.acquire().await.map_err(internal)?;
    let suggestion = suggested_weight(&mut conn, &input.category, &tags).await?;
    Ok(Json(match suggestion {
        Some((version, weight)) => {
            let points = proposed_place_points(&mut conn, version, &input.category).await?;
            let details: String =
                sqlx::query_scalar("SELECT details_md FROM scoring_model_versions WHERE version=?")
                    .bind(version)
                    .fetch_one(&mut *conn)
                    .await
                    .map_err(internal)?;
            json!({"status":"ready","modelVersion":version,"weightMilli":weight,"placePoints":points,"detailsMarkdown":details})
        }
        None => json!({"status":"unavailable"}),
    }))
}

pub(crate) async fn event_weight(
    conn: &mut SqliteConnection,
    event_id: &str,
) -> ApiResult<(i64, Option<i64>)> {
    let row: Option<(i64, Option<i64>)> =
        sqlx::query_as("SELECT weight_milli,model_version FROM event_scoring WHERE event_id=?")
            .bind(event_id)
            .fetch_optional(conn)
            .await
            .map_err(internal)?;
    row.ok_or(bad("Event scoring policy unavailable"))
}

pub(crate) async fn event_date(conn: &mut SqliteConnection, event_id: &str) -> ApiResult<String> {
    sqlx::query_scalar("SELECT starts_at FROM events WHERE id=?")
        .bind(event_id)
        .fetch_one(conn)
        .await
        .map_err(internal)
}

pub(crate) async fn assign_validator(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ValidatorAssignment>,
) -> ApiResult<Json<Value>> {
    check_origin(&state, &headers)?;
    let actor = session::viewer(&state, &headers).await?;
    if actor.role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Admin required"));
    }
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM members WHERE id=? AND role IN ('officer','admin')")
            .bind(&input.member_id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    if exists.is_none() {
        return Err(bad("Approved officer required"));
    }
    sqlx::query("INSERT INTO scoring_validators(member_id,skill_slug,assigned_by,assigned_at) VALUES (?,?,?,?) ON CONFLICT(member_id,skill_slug) DO NOTHING")
        .bind(&input.member_id).bind(&input.skill_slug).bind(&actor.id).bind(Utc::now().to_rfc3339())
        .execute(&state.db).await.map_err(internal)?;
    Ok(Json(json!({"ok":true})))
}

pub(crate) async fn create_comparison(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<NewComparison>,
) -> ApiResult<Json<Value>> {
    check_origin(&state, &headers)?;
    let actor = session::viewer(&state, &headers).await?;
    if actor.role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Admin required"));
    }
    if input.member_a == input.member_b {
        return Err(bad("Two distinct members required"));
    }
    let (a, b) = if input.member_a < input.member_b {
        (input.member_a, input.member_b)
    } else {
        (input.member_b, input.member_a)
    };
    let count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM members WHERE id IN (?,?) AND role!='pending'")
            .bind(&a)
            .bind(&b)
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;
    if count.0 != 2 {
        return Err(bad("Two approved members required"));
    }
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let evidence_a = evidence_summary(&state.db, &a, &input.skill_slug, &now)
        .await
        .map_err(internal)?;
    let evidence_b = evidence_summary(&state.db, &b, &input.skill_slug, &now)
        .await
        .map_err(internal)?;
    if evidence_a["achievements"]
        .as_array()
        .is_none_or(|rows| rows.is_empty())
        || evidence_b["achievements"]
            .as_array()
            .is_none_or(|rows| rows.is_empty())
    {
        return Err(bad("Both candidates need skill evidence"));
    }
    let evidence_a = evidence_a.to_string();
    let evidence_b = evidence_b.to_string();
    let revision = evidence_revision(&evidence_a, &evidence_b);
    let inserted = sqlx::query("INSERT INTO skill_comparisons(id,skill_slug,member_a,member_b,evidence_cutoff,evidence_a_json,evidence_b_json,created_by,created_at,evidence_revision) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING")
        .bind(&id).bind(&input.skill_slug).bind(&a).bind(&b).bind(&now)
        .bind(&evidence_a).bind(&evidence_b).bind(&actor.id).bind(&now).bind(revision)
        .execute(&state.db).await.map_err(internal)?;
    if inserted.rows_affected() == 0 {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Comparison already exists for this evidence",
        ));
    }
    Ok(Json(json!({"id":id})))
}

pub(super) fn evidence_revision(a: &str, b: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut digest = Sha256::new();
    digest.update(a.as_bytes());
    digest.update([0]);
    digest.update(b.as_bytes());
    hex::encode(digest.finalize())
}

// Mental model: the validator receives only two evidence summaries. IDs, names, handles,
// URLs, authored titles and current point totals never cross this response boundary.
pub(crate) async fn review_required_comparisons(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    let viewer = session::viewer(&state, &headers).await?;
    if viewer.role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Admin required"));
    }
    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT c.id,c.skill_slug,COUNT(*) FROM skill_comparisons c \
         JOIN comparison_validator_assignments a ON a.comparison_id=c.id \
         WHERE a.status='review_required' GROUP BY c.id,c.skill_slug ORDER BY c.created_at LIMIT 30",
    )
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(json!(
        rows.into_iter()
            .map(|(id, skill, tasks)| json!({"id":id,"skill":skill,"tasks":tasks}))
            .collect::<Vec<_>>()
    )))
}

pub(crate) async fn comparison_queue(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    let viewer = session::viewer(&state, &headers).await?;
    if !matches!(viewer.role.as_str(), "officer" | "admin") {
        return Err(ApiError(StatusCode::FORBIDDEN, "Officer required"));
    }
    let rows = sqlx::query(
        "SELECT c.id,c.skill_slug,c.evidence_a_json,c.evidence_b_json,COALESCE(a.flip,0),c.member_a,c.member_b,COALESCE(c.season_slug,'legacy') FROM skill_comparisons c \
         LEFT JOIN comparison_validator_assignments a ON a.comparison_id=c.id AND a.validator_id=? \
         WHERE c.member_a!=? AND c.member_b!=? AND ((c.scheduler_run_key IS NULL AND EXISTS (SELECT 1 FROM scoring_validators v WHERE v.skill_slug=c.skill_slug AND v.member_id=?)) OR (a.status='pending' AND a.due_at>=?)) AND NOT EXISTS \
         (SELECT 1 FROM skill_comparison_votes x WHERE x.comparison_id=c.id AND x.validator_id=?) \
         ORDER BY c.created_at LIMIT 30",
    )
    .bind(&viewer.id)
    .bind(&viewer.id)
    .bind(&viewer.id)
    .bind(&viewer.id)
    .bind(Utc::now().to_rfc3339())
    .bind(&viewer.id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    let mut result = Vec::new();
    for row in rows {
        let id: String = row.get(0);
        let skill: String = row.get(1);
        let mut a: Value = serde_json::from_str(row.get::<&str, _>(2)).map_err(internal)?;
        let mut b: Value = serde_json::from_str(row.get::<&str, _>(3)).map_err(internal)?;
        let season: String = row.get(7);
        let mut label_a = candidate_label(&state.email_code_secret, &season, &skill, row.get(5));
        let mut label_b = candidate_label(&state.email_code_secret, &season, &skill, row.get(6));
        if row.get::<i64, _>(4) == 1 {
            std::mem::swap(&mut a, &mut b);
            std::mem::swap(&mut label_a, &mut label_b);
        }
        result.push(json!({"id":id,"skill":skill,"season":season,
            "a":{"label":label_a,"achievements":a["achievements"],"projects":a["projects"]},
            "b":{"label":label_b,"achievements":b["achievements"],"projects":b["projects"]}}));
    }
    Ok(Json(json!(result)))
}

fn candidate_label(secret: &str, season: &str, skill: &str, member_id: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC key accepted");
    mac.update(b"scoring-candidate-v1:");
    mac.update(season.as_bytes());
    mac.update(b":");
    mac.update(skill.as_bytes());
    mac.update(b":");
    mac.update(member_id.as_bytes());
    format!("#{}", &hex::encode(mac.finalize().into_bytes())[..16])
}

async fn evidence_summary(
    db: &SqlitePool,
    member_id: &str,
    skill: &str,
    cutoff: &str,
) -> Result<Value, sqlx::Error> {
    let event_rows: Vec<(String,Option<i64>,i64,String)> = sqlx::query_as(
        "SELECT e.category,p.place,p.base_points,e.starts_at FROM point_awards p JOIN events e ON e.id=p.event_id \
         JOIN event_skill_tags t ON t.event_id=e.id WHERE p.member_id=? AND t.skill_slug=? AND p.created_at<=? \
         ORDER BY e.starts_at DESC LIMIT 30"
    ).bind(member_id).bind(skill).bind(cutoff).fetch_all(db).await?;
    let feature_rows: Vec<(String,i64)> = sqlx::query_as(
        "SELECT e.category,SUM(p.base_points) FROM point_awards p JOIN events e ON e.id=p.event_id \
         JOIN event_skill_tags t ON t.event_id=e.id WHERE p.member_id=? AND t.skill_slug=? AND p.created_at<=? GROUP BY e.category"
    ).bind(member_id).bind(skill).bind(cutoff).fetch_all(db).await?;
    let projects: Vec<(i64, String)> = sqlx::query_as(
        "SELECT COALESCE(points,0),reviewed_at FROM evidence_claims WHERE member_id=? AND kind='personal_project' AND status='approved' AND reviewed_at<=? ORDER BY reviewed_at DESC LIMIT 10",
    ).bind(member_id).bind(cutoff).fetch_all(db).await?;
    Ok(json!({
        "achievements":event_rows.into_iter().map(|(kind,place,base,at)|json!({"kind":kind,"place":place,"basePoints":base,"date":at})).collect::<Vec<_>>(),
        "projects":projects.into_iter().map(|(points,at)|json!({"kind":"approved project","points":points,"date":at})).collect::<Vec<_>>(),
        "featureTotals":feature_rows.into_iter().collect::<std::collections::HashMap<_,_>>()
    }))
}

pub(crate) async fn cast_vote(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<Vote>,
) -> ApiResult<Json<Value>> {
    check_origin(&state, &headers)?;
    let viewer = session::viewer(&state, &headers).await?;
    if !matches!(viewer.role.as_str(), "officer" | "admin") {
        return Err(ApiError(StatusCode::FORBIDDEN, "Officer required"));
    }
    if !matches!(input.outcome.as_str(), "a" | "b" | "draw") {
        return Err(bad("Invalid outcome"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    let eligible: Option<(Option<String>, i64)> = sqlx::query_as(
        "SELECT c.scheduler_run_key,COALESCE(a.flip,0) FROM skill_comparisons c \
         LEFT JOIN comparison_validator_assignments a ON a.comparison_id=c.id AND a.validator_id=? \
         WHERE c.id=? AND c.member_a!=? AND c.member_b!=? AND ((c.scheduler_run_key IS NULL AND EXISTS (SELECT 1 FROM scoring_validators v WHERE v.skill_slug=c.skill_slug AND v.member_id=?)) OR (a.status='pending' AND a.due_at>=?))"
    ).bind(&viewer.id).bind(&id).bind(&viewer.id).bind(&viewer.id).bind(&viewer.id).bind(Utc::now().to_rfc3339())
        .fetch_optional(&mut *tx).await.map_err(internal)?;
    if eligible.is_none() {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Validator assignment required",
        ));
    }
    let (scheduled, flip) = eligible
        .as_ref()
        .map(|row| (row.0.is_some(), row.1 == 1))
        .unwrap_or((false, false));
    let canonical_outcome = match (flip, input.outcome.as_str()) {
        (true, "a") => "b",
        (true, "b") => "a",
        _ => input.outcome.as_str(),
    };
    let inserted = sqlx::query("INSERT INTO skill_comparison_votes(comparison_id,validator_id,outcome,decided_at) VALUES (?,?,?,?) ON CONFLICT(comparison_id,validator_id) DO NOTHING")
        .bind(&id).bind(&viewer.id).bind(canonical_outcome).bind(Utc::now().to_rfc3339())
        .execute(&mut *tx).await.map_err(internal)?;
    if inserted.rows_affected() == 0 {
        return Err(ApiError(StatusCode::CONFLICT, "Vote already submitted"));
    }
    if scheduled {
        sqlx::query("UPDATE comparison_validator_assignments SET status='completed',finished_at=? WHERE comparison_id=? AND validator_id=? AND status='pending'")
            .bind(Utc::now().to_rfc3339()).bind(&id).bind(&viewer.id).execute(&mut *tx).await.map_err(internal)?;
        scheduler::assignment_audit(&mut tx, &id, &viewer.id, "completed")
            .await
            .map_err(internal)?;
    }
    tx.commit().await.map_err(internal)?;
    tracing::info!(component="scoring",operation="validator_vote",comparison_id=%id,validator_id=%viewer.id,outcome=%canonical_outcome,"scoring.vote_recorded");
    Ok(Json(json!({"ok":true})))
}

pub(crate) async fn comparison_summary(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let viewer = session::viewer(&state, &headers).await?;
    if viewer.role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Admin required"));
    }
    let counts: Vec<(String,i64)> = sqlx::query_as(
        "SELECT outcome,COUNT(*) FROM skill_comparison_votes WHERE comparison_id=? GROUP BY outcome"
    ).bind(&id).fetch_all(&state.db).await.map_err(internal)?;
    let total: i64 = counts.iter().map(|(_, count)| count).sum();
    let winner = counts.iter().max_by_key(|(_, count)| count);
    let consensus = winner
        .and_then(|(label, count)| (total >= 3 && count * 3 >= total * 2).then(|| label.clone()));
    Ok(Json(
        json!({"votes":total,"counts":counts.into_iter().collect::<std::collections::HashMap<_,_>>(),
        "consensus":consensus,"status":if consensus.is_some(){"accepted"}else{"unresolved"}}),
    ))
}
