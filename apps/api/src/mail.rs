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
use std::{collections::HashSet, sync::Arc};
use subtle::ConstantTimeEq;
use uuid::Uuid;

const ROLES: &[&str] = &[
    "ambassador",
    "secretariat",
    "treasurer",
    "external_relations",
    "academics",
    "executive",
    "campus_lead",
];

fn roles_valid(roles: &[String]) -> bool {
    !roles.is_empty()
        && roles.len() <= ROLES.len()
        && roles.iter().all(|role| ROLES.contains(&role.as_str()))
        && roles.iter().collect::<HashSet<_>>().len() == roles.len()
}

fn valid_address(address: &str) -> bool {
    address.len() <= 320
        && !address.is_empty()
        && !address
            .bytes()
            .any(|value| value.is_ascii_whitespace() || value.is_ascii_control())
        && address.split('@').count() == 2
        && address.split('@').all(|part| !part.is_empty())
}

fn valid_content(recipients: &[String], subject: &str, body: &str, pdf_text: Option<&str>) -> bool {
    !recipients.is_empty()
        && recipients.len() <= 25
        && recipients.iter().all(|address| valid_address(address))
        && recipients.iter().collect::<HashSet<_>>().len() == recipients.len()
        && !subject.trim().is_empty()
        && subject.len() <= 200
        && !body.trim().is_empty()
        && body.len() <= 20_000
        && pdf_text.is_none_or(|text| text.len() <= 20_000)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoleList {
    roles: Vec<String>,
}

pub async fn set_officer_roles(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(member_id): Path<String>,
    Json(input): Json<RoleList>,
) -> ApiResult<StatusCode> {
    check_origin(&state, &headers)?;
    let actor = auth::viewer(&state, &headers).await?;
    if actor.role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Admin access required"));
    }
    if input.roles.len() > ROLES.len()
        || input
            .roles
            .iter()
            .any(|role| !ROLES.contains(&role.as_str()))
        || input.roles.iter().collect::<HashSet<_>>().len() != input.roles.len()
    {
        return Err(bad("Invalid officer roles"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    let role: Option<(String,)> = sqlx::query_as("SELECT role FROM members WHERE id = ?")
        .bind(&member_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(internal)?;
    if !matches!(
        role.as_ref().map(|row| row.0.as_str()),
        Some("officer" | "admin")
    ) {
        return Err(bad("Target must be an approved officer"));
    }
    sqlx::query("DELETE FROM officer_roles WHERE member_id = ?")
        .bind(&member_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    for role in input.roles {
        sqlx::query("INSERT INTO officer_roles(member_id,role) VALUES (?,?)")
            .bind(&member_id)
            .bind(role)
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
    }
    sqlx::query(
        "INSERT INTO audit_events(id,actor_id,operation,entity_id,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&actor.id)
    .bind("officer_roles.changed")
    .bind(&member_id)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RouteInput {
    required_roles: Vec<String>,
    sender_role: String,
}

pub async fn set_route(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(category): Path<String>,
    Json(input): Json<RouteInput>,
) -> ApiResult<StatusCode> {
    check_origin(&state, &headers)?;
    let actor = auth::viewer(&state, &headers).await?;
    if actor.role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Admin access required"));
    }
    if category.is_empty()
        || category.len() > 64
        || !category
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
        || !roles_valid(&input.required_roles)
        || !ROLES.contains(&input.sender_role.as_str())
    {
        return Err(bad("Invalid mail route"));
    }
    sqlx::query("INSERT INTO mail_routes(category,required_roles_json,sender_role,updated_by,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(category) DO UPDATE SET required_roles_json=excluded.required_roles_json,sender_role=excluded.sender_role,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
        .bind(category).bind(serde_json::to_string(&input.required_roles).map_err(internal)?)
        .bind(input.sender_role).bind(&actor.id).bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db).await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Content {
    recipients: Vec<String>,
    subject: String,
    body: String,
    pdf_text: Option<String>,
    required_roles: Vec<String>,
    sender_role: String,
}

fn content_hash(content: &Content) -> ApiResult<String> {
    let json = serde_json::to_vec(content).map_err(internal)?;
    Ok(hex::encode(Sha256::digest(json)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewDraft {
    category: String,
    recipients: Vec<String>,
    subject: String,
    body: String,
    pdf_text: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRef {
    id: String,
    revision: i64,
    content_hash: String,
}

pub async fn create_draft(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<NewDraft>,
) -> ApiResult<(StatusCode, Json<DraftRef>)> {
    check_origin(&state, &headers)?;
    let actor = auth::require_officer(&state, &headers).await?;
    if !valid_content(
        &input.recipients,
        &input.subject,
        &input.body,
        input.pdf_text.as_deref(),
    ) {
        return Err(bad("Invalid mail content"));
    }
    let route: Option<(String, String)> = sqlx::query_as(
        "SELECT required_roles_json,sender_role FROM mail_routes WHERE category = ?",
    )
    .bind(&input.category)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    let Some((required_json, sender_role)) = route else {
        return Err(bad("Recipient category has no route"));
    };
    let required_roles: Vec<String> = serde_json::from_str(&required_json).map_err(internal)?;
    let content = Content {
        recipients: input.recipients,
        subject: input.subject,
        body: input.body,
        pdf_text: input.pdf_text,
        required_roles,
        sender_role,
    };
    let hash = content_hash(&content)?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let mut tx = state.db.begin().await.map_err(internal)?;
    sqlx::query("INSERT INTO mail_drafts(id,category,created_by,current_revision,status,created_at,updated_at) VALUES (?,?,?,1,'draft',?,?)")
        .bind(&id).bind(&input.category).bind(&actor.id).bind(&now).bind(&now).execute(&mut *tx).await.map_err(internal)?;
    insert_revision(&mut tx, &id, 1, &content, &hash, &actor.id).await?;
    tx.commit().await.map_err(internal)?;
    Ok((
        StatusCode::CREATED,
        Json(DraftRef {
            id,
            revision: 1,
            content_hash: hash,
        }),
    ))
}

async fn insert_revision(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
    revision: i64,
    content: &Content,
    hash: &str,
    actor_id: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO mail_revisions(draft_id,revision,recipients_json,subject,body,pdf_text,content_hash,required_roles_json,sender_role,edited_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(id).bind(revision).bind(serde_json::to_string(&content.recipients).map_err(internal)?)
        .bind(&content.subject).bind(&content.body).bind(&content.pdf_text).bind(hash)
        .bind(serde_json::to_string(&content.required_roles).map_err(internal)?)
        .bind(&content.sender_role).bind(actor_id).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut **tx).await.map_err(internal)?;
    Ok(())
}

async fn current(state: &AppState, id: &str) -> ApiResult<(i64, String, Content)> {
    let row = sqlx::query("SELECT d.current_revision,d.status,r.recipients_json,r.subject,r.body,r.pdf_text,r.required_roles_json,r.sender_role FROM mail_drafts d JOIN mail_revisions r ON r.draft_id=d.id AND r.revision=d.current_revision WHERE d.id=?")
        .bind(id).fetch_optional(&state.db).await.map_err(internal)?
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Draft not found"))?;
    let content = Content {
        recipients: serde_json::from_str(row.get::<&str, _>(2)).map_err(internal)?,
        subject: row.get(3),
        body: row.get(4),
        pdf_text: row.get(5),
        required_roles: serde_json::from_str(row.get::<&str, _>(6)).map_err(internal)?,
        sender_role: row.get(7),
    };
    Ok((row.get(0), row.get(1), content))
}

async fn require_draft_access(
    state: &AppState,
    actor: &auth::Viewer,
    draft_id: &str,
    content: &Content,
) -> ApiResult<()> {
    if actor.role == "admin" {
        return Ok(());
    }
    let creator: Option<(String,)> =
        sqlx::query_as("SELECT created_by FROM mail_drafts WHERE id=?")
            .bind(draft_id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    if creator.as_ref().is_some_and(|row| row.0 == actor.id) {
        return Ok(());
    }
    for role in content
        .required_roles
        .iter()
        .chain(std::iter::once(&content.sender_role))
    {
        if has_role(state, &actor.id, role).await? {
            return Ok(());
        }
    }
    Err(ApiError(StatusCode::FORBIDDEN, "Draft access denied"))
}

pub async fn read_draft(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let actor = auth::require_officer(&state, &headers).await?;
    let (revision, status, content) = current(&state, &id).await?;
    require_draft_access(&state, &actor, &id, &content).await?;
    let approvals: Vec<(String,)> =
        sqlx::query_as("SELECT role FROM mail_approvals WHERE draft_id=? AND revision=?")
            .bind(&id)
            .bind(revision)
            .fetch_all(&state.db)
            .await
            .map_err(internal)?;
    Ok(Json(
        serde_json::json!({"id": id, "revision": revision, "status": status, "contentHash": content_hash(&content)?, "content": content, "approvedRoles": approvals.into_iter().map(|row| row.0).collect::<Vec<_>>() }),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftPatch {
    recipients: Option<Vec<String>>,
    subject: Option<String>,
    body: Option<String>,
    pdf_text: Option<String>,
}

pub async fn edit_draft(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(patch): Json<DraftPatch>,
) -> ApiResult<Json<DraftRef>> {
    check_origin(&state, &headers)?;
    let actor = auth::require_officer(&state, &headers).await?;
    let expected: i64 = headers
        .get("if-match")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim_matches('"').parse().ok())
        .ok_or(ApiError(
            StatusCode::PRECONDITION_REQUIRED,
            "If-Match revision required",
        ))?;
    let (revision, status, mut content) = current(&state, &id).await?;
    require_draft_access(&state, &actor, &id, &content).await?;
    if revision != expected {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "Stale draft revision",
        ));
    }
    if status != "draft" && status != "ready" {
        return Err(bad("Released draft cannot be edited"));
    }
    if let Some(value) = patch.recipients {
        content.recipients = value;
    }
    if let Some(value) = patch.subject {
        content.subject = value;
    }
    if let Some(value) = patch.body {
        content.body = value;
    }
    if let Some(value) = patch.pdf_text {
        content.pdf_text = if value.is_empty() { None } else { Some(value) };
    }
    if !valid_content(
        &content.recipients,
        &content.subject,
        &content.body,
        content.pdf_text.as_deref(),
    ) {
        return Err(bad("Invalid mail content"));
    }
    let hash = content_hash(&content)?;
    let old_hash: (String,) =
        sqlx::query_as("SELECT content_hash FROM mail_revisions WHERE draft_id=? AND revision=?")
            .bind(&id)
            .bind(revision)
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;
    if old_hash.0 == hash {
        return Ok(Json(DraftRef {
            id,
            revision,
            content_hash: hash,
        }));
    }
    let next_revision = revision + 1;
    let mut tx = state.db.begin().await.map_err(internal)?;
    let changed = sqlx::query("UPDATE mail_drafts SET current_revision=?,status='draft',updated_at=? WHERE id=? AND current_revision=? AND status IN ('draft','ready')")
        .bind(next_revision).bind(chrono::Utc::now().to_rfc3339()).bind(&id).bind(revision)
        .execute(&mut *tx).await.map_err(internal)?.rows_affected();
    if changed != 1 {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "Stale draft revision",
        ));
    }
    insert_revision(&mut tx, &id, next_revision, &content, &hash, &actor.id).await?;
    tx.commit().await.map_err(internal)?;
    Ok(Json(DraftRef {
        id,
        revision: next_revision,
        content_hash: hash,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApproveInput {
    revision: i64,
    role: String,
}

async fn has_role(state: &AppState, member_id: &str, role: &str) -> ApiResult<bool> {
    let found: Option<(String,)> =
        sqlx::query_as("SELECT role FROM officer_roles WHERE member_id=? AND role=?")
            .bind(member_id)
            .bind(role)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    Ok(found.is_some())
}

pub async fn approve_draft(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<ApproveInput>,
) -> ApiResult<StatusCode> {
    check_origin(&state, &headers)?;
    let actor = auth::require_officer(&state, &headers).await?;
    let (revision, status, content) = current(&state, &id).await?;
    if revision != input.revision {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "Stale draft revision",
        ));
    }
    if !matches!(status.as_str(), "draft" | "ready")
        || !content.required_roles.contains(&input.role)
        || !has_role(&state, &actor.id, &input.role).await?
    {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Approval role not permitted",
        ));
    }
    sqlx::query("INSERT INTO mail_approvals(draft_id,revision,role,approver_id,created_at) VALUES (?,?,?,?,?) ON CONFLICT(draft_id,revision,role) DO UPDATE SET approver_id=excluded.approver_id,created_at=excluded.created_at")
        .bind(&id).bind(revision).bind(&input.role).bind(&actor.id).bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db).await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseInput {
    revision: i64,
}

pub async fn release_draft(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<ReleaseInput>,
) -> ApiResult<StatusCode> {
    check_origin(&state, &headers)?;
    let actor = auth::require_officer(&state, &headers).await?;
    let (revision, status, content) = current(&state, &id).await?;
    if revision != input.revision {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "Stale draft revision",
        ));
    }
    if status != "draft" && status != "ready" {
        return Err(bad("Draft is not releasable"));
    }
    if content.pdf_text.is_some() {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "PDF rendering is not configured",
        ));
    }
    if !has_role(&state, &actor.id, &content.sender_role).await? {
        return Err(ApiError(StatusCode::FORBIDDEN, "Sender role required"));
    }
    let approved: Vec<(String,)> = sqlx::query_as("SELECT a.role FROM mail_approvals a JOIN officer_roles r ON r.member_id=a.approver_id AND r.role=a.role WHERE a.draft_id=? AND a.revision=?")
        .bind(&id).bind(revision).fetch_all(&state.db).await.map_err(internal)?;
    if !content
        .required_roles
        .iter()
        .all(|role| approved.iter().any(|row| &row.0 == role))
    {
        return Err(bad("Required approvals are incomplete"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    let changed = sqlx::query("UPDATE mail_drafts SET status='released',updated_at=? WHERE id=? AND current_revision=? AND status IN ('draft','ready')")
        .bind(chrono::Utc::now().to_rfc3339()).bind(&id).bind(revision).execute(&mut *tx).await.map_err(internal)?.rows_affected();
    if changed != 1 {
        return Err(ApiError(StatusCode::PRECONDITION_FAILED, "Draft changed"));
    }
    sqlx::query("INSERT INTO mail_dispatch(draft_id,revision,content_hash,status,updated_at) VALUES (?,?,?,'pending',?)")
        .bind(&id).bind(revision).bind(content_hash(&content)?).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *tx).await.map_err(internal)?;
    sqlx::query("INSERT INTO audit_events(id,actor_id,operation,entity_id,revision,created_at) VALUES (?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(&actor.id).bind("mail.released").bind(&id).bind(revision)
        .bind(chrono::Utc::now().to_rfc3339()).execute(&mut *tx).await.map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

fn check_workflow_key(state: &AppState, headers: &HeaderMap) -> ApiResult<()> {
    if !state.live_email_enabled {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "Live email disabled",
        ));
    }
    let expected = state.workflow_key.as_ref().ok_or(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Workflow key missing",
    ))?;
    let provided = headers
        .get("x-workflow-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if provided.len() != expected.len()
        || !bool::from(provided.as_bytes().ct_eq(expected.as_bytes()))
    {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "Workflow key invalid"));
    }
    Ok(())
}

pub async fn claim_dispatch(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    check_workflow_key(&state, &headers)?;
    let mut tx = state.db.begin().await.map_err(internal)?;
    let row: Option<(String, i64, String)> = sqlx::query_as("SELECT draft_id,revision,content_hash FROM mail_dispatch WHERE status='pending' ORDER BY updated_at LIMIT 1")
        .fetch_optional(&mut *tx).await.map_err(internal)?;
    let Some((id, revision, hash)) = row else {
        return Ok(Json(serde_json::json!({"job": null})));
    };
    sqlx::query("UPDATE mail_dispatch SET status='claimed',claimed_at=?,updated_at=? WHERE draft_id=? AND status='pending'")
        .bind(chrono::Utc::now().to_rfc3339()).bind(chrono::Utc::now().to_rfc3339()).bind(&id)
        .execute(&mut *tx).await.map_err(internal)?;
    let row = sqlx::query("SELECT recipients_json,subject,body,pdf_text FROM mail_revisions WHERE draft_id=? AND revision=? AND content_hash=?")
        .bind(&id).bind(revision).bind(&hash).fetch_one(&mut *tx).await.map_err(internal)?;
    let recipients: Vec<String> = serde_json::from_str(row.get::<&str, _>(0)).map_err(internal)?;
    let subject: String = row.get(1);
    let body: String = row.get(2);
    let pdf_text: Option<String> = row.get(3);
    tx.commit().await.map_err(internal)?;
    Ok(Json(
        serde_json::json!({"job": {"id": id, "revision": revision, "recipients": recipients, "subject": subject, "body": body, "pdfText": pdf_text}}),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    status: String,
    external_message_id: Option<String>,
}

pub async fn record_receipt(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<Receipt>,
) -> ApiResult<StatusCode> {
    check_workflow_key(&state, &headers)?;
    if !matches!(input.status.as_str(), "sent" | "uncertain" | "failed")
        || (input.status == "sent"
            && input
                .external_message_id
                .as_deref()
                .unwrap_or("")
                .is_empty())
    {
        return Err(bad("Invalid delivery receipt"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    let changed = sqlx::query("UPDATE mail_dispatch SET status=?,external_message_id=?,updated_at=? WHERE draft_id=? AND status='claimed'")
        .bind(&input.status).bind(&input.external_message_id).bind(chrono::Utc::now().to_rfc3339()).bind(&id)
        .execute(&mut *tx).await.map_err(internal)?.rows_affected();
    if changed != 1 {
        return Err(ApiError(
            StatusCode::PRECONDITION_FAILED,
            "Dispatch is not claimed",
        ));
    }
    sqlx::query("UPDATE mail_drafts SET status=?,updated_at=? WHERE id=?")
        .bind(&input.status)
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(draft_id = %id, status = %input.status, "mail.dispatch_result");
    Ok(StatusCode::NO_CONTENT)
}
