use crate::auth;
use crate::{ApiError, ApiResult, AppState, bad, check_origin, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportRequest {
    form_id: String,
    points: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    fetched: usize,
    awarded: usize,
    unmatched: usize,
    duplicates: usize,
    duplicate_members: usize,
    leaderboard_job_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResponsePage {
    #[serde(default)]
    responses: Vec<FormResponse>,
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormResponse {
    response_id: String,
    #[serde(default)]
    create_time: String,
    last_submitted_time: Option<String>,
    respondent_email: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormMetadata {
    settings: Option<FormSettings>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormSettings {
    email_collection_type: Option<String>,
}

fn valid_google_id(value: &str) -> bool {
    (8..=256).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn normalized_email(response: &FormResponse) -> Option<String> {
    let raw = response.respondent_email.as_deref()?;
    let email = raw.trim().to_ascii_lowercase();
    if email.len() <= 320
        && email.split('@').count() == 2
        && email.split('@').all(|part| !part.is_empty())
        && !email.bytes().any(|byte| byte.is_ascii_whitespace())
    {
        Some(email)
    } else {
        None
    }
}

async fn access_token(state: &AppState) -> ApiResult<String> {
    let client_id = state.google_forms_client_id.as_deref().ok_or(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Google Forms OAuth is not configured",
    ))?;
    let client_secret = state.google_forms_client_secret.as_deref().ok_or(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Google Forms OAuth is not configured",
    ))?;
    let refresh_token = state.google_forms_refresh_token.as_deref().ok_or(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Google Forms OAuth is not configured",
    ))?;
    let body = {
        let mut serializer = url::form_urlencoded::Serializer::new(String::new());
        serializer
            .append_pair("client_id", client_id)
            .append_pair("client_secret", client_secret)
            .append_pair("refresh_token", refresh_token)
            .append_pair("grant_type", "refresh_token");
        serializer.finish()
    };
    let response = state
        .http
        .post("https://oauth2.googleapis.com/token")
        .header("content-type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(internal)?
        .error_for_status()
        .map_err(internal)?
        .json::<TokenResponse>()
        .await
        .map_err(internal)?;
    Ok(response.access_token)
}

async fn fetch_responses(
    state: &AppState,
    token: &str,
    form_id: &str,
) -> ApiResult<Vec<FormResponse>> {
    let mut all = Vec::new();
    let mut page_token: Option<String> = None;
    for _ in 0..20 {
        let mut request = state
            .http
            .get(format!(
                "https://forms.googleapis.com/v1/forms/{form_id}/responses"
            ))
            .bearer_auth(token)
            .query(&[("pageSize", "500")]);
        if let Some(token) = page_token.as_deref() {
            request = request.query(&[("pageToken", token)]);
        }
        let page = request
            .send()
            .await
            .map_err(internal)?
            .error_for_status()
            .map_err(internal)?
            .json::<ResponsePage>()
            .await
            .map_err(internal)?;
        all.extend(page.responses);
        page_token = page.next_page_token;
        if page_token.is_none() {
            return Ok(all);
        }
    }
    Err(ApiError(
        StatusCode::BAD_GATEWAY,
        "Google Forms pagination limit exceeded",
    ))
}

async fn require_verified_form(state: &AppState, token: &str, form_id: &str) -> ApiResult<()> {
    let form = state
        .http
        .get(format!("https://forms.googleapis.com/v1/forms/{form_id}"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(internal)?
        .error_for_status()
        .map_err(internal)?
        .json::<FormMetadata>()
        .await
        .map_err(internal)?;
    if form
        .settings
        .and_then(|settings| settings.email_collection_type)
        .as_deref()
        != Some("VERIFIED")
    {
        return Err(bad("Google Form must collect verified signed-in email"));
    }
    Ok(())
}

pub async fn import_google_form(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(event_id): Path<String>,
    Json(input): Json<ImportRequest>,
) -> ApiResult<Json<ImportResult>> {
    check_origin(&state, &headers)?;
    let actor = auth::require_officer(&state, &headers).await?;
    if !valid_google_id(&input.form_id) || !(1..=1000).contains(&input.points) {
        return Err(bad("Invalid attendance import configuration"));
    }
    let event_start: Option<(String,)> = sqlx::query_as("SELECT starts_at FROM events WHERE id=?")
        .bind(&event_id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?;
    let Some((starts_at,)) = event_start else {
        return Err(ApiError(StatusCode::NOT_FOUND, "Event not found"));
    };
    let starts_at = chrono::DateTime::parse_from_rfc3339(&starts_at).map_err(internal)?;
    if starts_at > chrono::Utc::now() {
        return Err(bad("Attendance cannot be imported before the event starts"));
    }
    let existing = sqlx::query("SELECT form_id,points FROM attendance_sources WHERE event_id=?")
        .bind(&event_id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?;
    if let Some(row) = existing {
        if row.get::<String, _>(0) != input.form_id || row.get::<i64, _>(1) != input.points {
            return Err(bad("Attendance source is immutable after first import"));
        }
    }

    let token = access_token(&state).await?;
    require_verified_form(&state, &token, &input.form_id).await?;
    let responses = fetch_responses(&state, &token, &input.form_id).await?;
    let fetched = responses.len();
    let now = chrono::Utc::now().to_rfc3339();
    let mut tx = state.db.begin().await.map_err(internal)?;
    let source_changed = sqlx::query("INSERT INTO attendance_sources(event_id,form_id,points,configured_by,created_at,last_imported_at) VALUES (?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET last_imported_at=excluded.last_imported_at WHERE attendance_sources.form_id=excluded.form_id AND attendance_sources.points=excluded.points")
        .bind(&event_id).bind(&input.form_id).bind(input.points)
        .bind(&actor.id).bind(&now).bind(&now).execute(&mut *tx).await.map_err(internal)?.rows_affected();
    if source_changed != 1 {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "Attendance source changed",
        ));
    }
    let mut awarded = 0;
    let mut unmatched = 0;
    let mut duplicates = 0;
    let mut duplicate_members = 0;
    for response in responses {
        if response.response_id.is_empty()
            || response.response_id.len() > 256
            || response.last_submitted_time.is_none()
        {
            unmatched += 1;
            continue;
        }
        let submitted_at = response
            .last_submitted_time
            .as_deref()
            .unwrap_or(&response.create_time);
        let valid_submission =
            chrono::DateTime::parse_from_rfc3339(submitted_at).is_ok_and(|time| time >= starts_at);
        if !valid_submission {
            unmatched += 1;
            continue;
        }
        let email = normalized_email(&response);
        let member_id: Option<String> = if let Some(value) = email.as_deref() {
            sqlx::query_scalar("SELECT id FROM members WHERE email=? AND role!='pending'")
                .bind(value)
                .fetch_optional(&mut *tx)
                .await
                .map_err(internal)?
        } else {
            None
        };
        let prior: Option<(String,)> = sqlx::query_as(
            "SELECT status FROM attendance_responses WHERE form_id=? AND response_id=?",
        )
        .bind(&input.form_id)
        .bind(&response.response_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(internal)?;
        if prior.as_ref().is_some_and(|row| row.0 != "unmatched") {
            duplicates += 1;
            continue;
        }
        let already_awarded: Option<(String,)> = if let Some(id) = member_id.as_deref() {
            sqlx::query_as("SELECT response_id FROM attendance_responses WHERE event_id=? AND member_id=? AND status='awarded'")
                .bind(&event_id).bind(id).fetch_optional(&mut *tx).await.map_err(internal)?
        } else {
            None
        };
        let status = if member_id.is_none() {
            "unmatched"
        } else if already_awarded.is_some() {
            "duplicate_member"
        } else {
            "awarded"
        };
        let changed = sqlx::query("INSERT INTO attendance_responses(form_id,response_id,event_id,submitted_at,normalized_email,member_id,status,imported_by,imported_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(form_id,response_id) DO UPDATE SET normalized_email=excluded.normalized_email,member_id=excluded.member_id,status=excluded.status,imported_by=excluded.imported_by,imported_at=excluded.imported_at WHERE attendance_responses.status='unmatched'")
            .bind(&input.form_id).bind(&response.response_id).bind(&event_id).bind(submitted_at)
            .bind(&email).bind(&member_id).bind(status).bind(&actor.id).bind(&now)
            .execute(&mut *tx).await.map_err(internal)?.rows_affected();
        if changed == 0 {
            duplicates += 1;
            continue;
        }
        if status == "duplicate_member" {
            duplicate_members += 1;
        } else if let Some(member_id) = member_id {
            sqlx::query("INSERT INTO point_ledger(id,member_id,source_type,source_id,event_id,delta,actor_id,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
                .bind(Uuid::new_v4().to_string()).bind(member_id).bind("attendance")
                .bind(format!("{}:{}", input.form_id, response.response_id)).bind(&event_id)
                .bind(input.points).bind(&actor.id).bind("google_forms_attendance").bind(&now)
                .execute(&mut *tx).await.map_err(internal)?;
            awarded += 1;
        } else {
            unmatched += 1;
        }
    }
    let job_id = if awarded > 0 {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO jobs(id,kind,entity_id,status,available_at,created_at) VALUES (?,'leaderboard_refresh','global','pending',?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET status='pending',generation=generation+1,available_at=excluded.available_at,finished_at=NULL,result=NULL")
            .bind(&id).bind(&now).bind(&now).execute(&mut *tx).await.map_err(internal)?;
        sqlx::query_scalar::<_, String>(
            "SELECT id FROM jobs WHERE kind='leaderboard_refresh' AND entity_id='global'",
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(internal)?
    } else {
        None
    };
    sqlx::query(
        "INSERT INTO audit_events(id,actor_id,operation,entity_id,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&actor.id)
    .bind("attendance.imported")
    .bind(&event_id)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(event_id = %event_id, fetched, awarded, unmatched, duplicates, duplicate_members, "attendance.imported");
    Ok(Json(ImportResult {
        fetched,
        awarded,
        unmatched,
        duplicates,
        duplicate_members,
        leaderboard_job_id: job_id,
    }))
}

pub async fn read_attendance(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(event_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let _ = auth::require_officer(&state, &headers).await?;
    let source = sqlx::query(
        "SELECT form_id,points,last_imported_at FROM attendance_sources WHERE event_id=?",
    )
    .bind(&event_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    let Some(source) = source else {
        return Ok(Json(
            serde_json::json!({"source": null, "awarded": 0, "unmatched": 0}),
        ));
    };
    let awarded: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM attendance_responses WHERE event_id=? AND status='awarded'",
    )
    .bind(&event_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;
    let unmatched: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM attendance_responses WHERE event_id=? AND status='unmatched'",
    )
    .bind(&event_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(
        serde_json::json!({"source": {"formId": source.get::<String, _>(0), "points": source.get::<i64, _>(1), "lastImportedAt": source.get::<Option<String>, _>(2)}, "awarded": awarded, "unmatched": unmatched}),
    ))
}
