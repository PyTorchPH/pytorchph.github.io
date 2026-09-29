use crate::{ApiError, ApiResult, AppState, auth, bad, check_origin, internal};
use axum::{
    Json,
    body::Bytes,
    extract::{OriginalUri, Path, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex;
use uuid::Uuid;

static FIXTURES: OnceLock<Value> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::const_new(());
const ORG: &str = "__organization__";

fn fixtures() -> &'static Value {
    FIXTURES.get_or_init(|| {
        serde_json::from_str(include_str!("../seeds/demo-fixtures.json"))
            .expect("checked demo fixtures")
    })
}

fn reply(status: StatusCode, body: Value) -> Response {
    let mut response = (status, Json(body)).into_response();
    response
        .headers_mut()
        .insert("cache-control", "private, no-store".parse().unwrap());
    response
}

fn is_officer(role: &str) -> bool {
    role == "admin" || role == "officer"
}

fn fixture_item(audience: &str, key: &str) -> Option<&'static Value> {
    let set = fixtures().get(audience)?;
    set.get(key).or_else(|| set.get(key.split('?').next()?))
}

// An officer is an elevated member: their own views use the member fixtures, and only
// organization-wide officer data and the officer portal manifest use the officer set.
fn fixture_audience(role: &str, key: &str) -> &'static str {
    let officer_data = key == "/api/capabilities"
        || key.starts_with("/api/officer/")
        || key.starts_with("/api/feedback");
    if is_officer(role) && officer_data {
        "officer"
    } else {
        "member"
    }
}

fn fixture(role: &str, key: &str) -> Option<(StatusCode, Value)> {
    let item = fixture_item(fixture_audience(role, key), key)?;
    let status = StatusCode::from_u16(item.get("status")?.as_u64()? as u16).ok()?;
    let mut body = item.get("body")?.clone();
    if key == "/api/capabilities" && !is_officer(role) {
        // Career tools follow the same rules for every signed-in member; only the
        // portal block (officer tools, diagnostics) differs by role.
        let shared = fixture_item("officer", key)?
            .get("body")?
            .get("capabilities")?;
        body["capabilities"] = shared.clone();
    }
    Some((status, body))
}

fn scope<'a>(member_id: &'a str, key: &str) -> &'a str {
    if key == "/api/events"
        || key.starts_with("/api/events/")
        || key == "/api/feedback"
        || key.starts_with("/api/feedback/")
        || key.starts_with("/api/officer/")
    {
        ORG
    } else {
        member_id
    }
}

async fn stored(db: &SqlitePool, owner: &str, key: &str) -> ApiResult<Option<Value>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value_json FROM portal_state WHERE scope=? AND state_key=?")
            .bind(owner)
            .bind(key)
            .fetch_optional(db)
            .await
            .map_err(internal)?;
    row.map(|item| serde_json::from_str(&item.0).map_err(internal))
        .transpose()
}

async fn save(db: &SqlitePool, owner: &str, key: &str, value: &Value) -> ApiResult<()> {
    let encoded = serde_json::to_string(value).map_err(internal)?;
    if encoded.len() > 262_144 {
        return Err(bad("Product state is too large"));
    }
    sqlx::query("INSERT INTO portal_state(scope,state_key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(scope,state_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
        .bind(owner).bind(key).bind(encoded).bind(chrono::Utc::now().to_rfc3339())
        .execute(db).await.map_err(internal)?;
    Ok(())
}

async fn current(db: &SqlitePool, role: &str, owner: &str, key: &str) -> ApiResult<Value> {
    if let Some(value) = stored(db, owner, key).await? {
        return Ok(value);
    }
    fixture(role, key)
        .map(|(_, body)| body)
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Product view not found"))
}

fn field<'a>(body: &'a Value, name: &str) -> ApiResult<&'a str> {
    body.get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| bad("Invalid product action"))
}

fn limited(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max
}

fn json_body(bytes: &[u8]) -> ApiResult<Value> {
    serde_json::from_slice(bytes).map_err(|_| bad("Invalid JSON body"))
}

pub async fn gateway(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
    OriginalUri(uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    let actor = auth::viewer(&state, &headers).await?;
    if actor.role == "pending" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Member approval required"));
    }
    let key = format!("/api/{path}");
    if path.starts_with("officer/") && actor.role != "officer" && actor.role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"));
    }
    if method == Method::GET {
        if path.starts_with("backend/local-ai/") {
            return Ok(reply(StatusCode::OK, static_ai(&path)));
        }
        let query_key = uri
            .query()
            .map(|query| format!("{key}?{query}"))
            .unwrap_or_else(|| key.clone());
        if path == "member/leaderboard-identity" && uri.query().is_some() {
            let username = url::form_urlencoded::parse(uri.query().unwrap_or_default().as_bytes())
                .find(|(name, _)| name == "username")
                .map(|(_, value)| value.into_owned())
                .unwrap_or_default();
            return Ok(reply(
                StatusCode::OK,
                json!({"available": username_available(&state.db, &actor.id, &username).await?}),
            ));
        }
        if path == "events" {
            return Ok(reply(
                StatusCode::OK,
                read_external_events(&state.db, &actor).await?,
            ));
        }
        if path == "feedback" {
            return Ok(reply(
                StatusCode::OK,
                read_feedback(&state.db, &actor, uri.query()).await?,
            ));
        }
        let owner = scope(&actor.id, &key);
        if let Some(mut value) = stored(&state.db, owner, &query_key).await? {
            if path.starts_with("product/") {
                overlay_product(&state.db, &actor.id, &mut value).await?;
            }
            return Ok(reply(StatusCode::OK, value));
        }
        if let Some(mut value) = stored(&state.db, owner, &key).await? {
            if path.starts_with("product/") {
                overlay_product(&state.db, &actor.id, &mut value).await?;
            }
            return Ok(reply(StatusCode::OK, value));
        }
        let (status, mut value) = fixture(&actor.role, &query_key)
            .ok_or(ApiError(StatusCode::NOT_FOUND, "Product view not found"))?;
        if status == StatusCode::OK && path.starts_with("product/") {
            overlay_product(&state.db, &actor.id, &mut value).await?;
        }
        return Ok(reply(status, value));
    }
    check_origin(&state, &headers)?;
    let _write_guard = WRITE_LOCK.lock().await;
    let input = json_body(&body)?;
    let (status, result) = match (method.as_str(), path.as_str()) {
        ("PUT", "member/privacy") => (StatusCode::OK, privacy(&state.db, &actor.id, input).await?),
        ("PUT", "member/leaderboard-identity") => (
            StatusCode::OK,
            identity(&state.db, &actor.id, &actor.role, input).await?,
        ),
        ("POST", "product/demo-action") => (
            StatusCode::OK,
            demo_action(&state.db, &actor.id, &actor.role, input).await?,
        ),
        ("POST", "product/opportunities") => (
            StatusCode::CREATED,
            opportunity(&state.db, &actor.id, &actor.role, None, input).await?,
        ),
        ("PATCH", _) if path.starts_with("product/opportunities/") => (
            StatusCode::OK,
            opportunity(&state.db, &actor.id, &actor.role, Some(&path[22..]), input).await?,
        ),
        ("POST", "product/evidence") if input.get("photoData").is_some() => (
            StatusCode::CREATED,
            product_photo(&state, &actor, input).await?,
        ),
        ("POST", "product/evidence") => (
            StatusCode::CREATED,
            product_evidence(&state.db, &actor.id, &actor.role, None, input).await?,
        ),
        ("PATCH", _) if path.starts_with("product/evidence/") => (
            StatusCode::OK,
            product_evidence(&state.db, &actor.id, &actor.role, Some(&path[17..]), input).await?,
        ),
        ("POST", _) if path.starts_with("product/sources/") => (
            StatusCode::OK,
            product_source(&state.db, &actor.id, &actor.role, &path[16..], input).await?,
        ),
        ("POST", "product/evidence/analyze") => (StatusCode::OK, static_evidence_analysis(input)?),
        ("POST", "feedback") => (
            StatusCode::CREATED,
            create_feedback(&state.db, &actor, input).await?,
        ),
        ("POST", "events") => (
            StatusCode::CREATED,
            create_external_event(&state.db, &actor, input).await?,
        ),
        ("PATCH", _) if path.starts_with("events/") => (
            StatusCode::OK,
            external_event_action(&state.db, &actor, &path[7..], input).await?,
        ),
        ("PATCH", _) if path.starts_with("feedback/") && !path.ends_with("/notes") => (
            StatusCode::OK,
            update_feedback(&state.db, &actor, &path[9..], input).await?,
        ),
        ("POST", _) if path.starts_with("feedback/") && path.ends_with("/notes") => (
            StatusCode::CREATED,
            note_feedback(&state.db, &actor, &path[9..path.len() - 6], input).await?,
        ),
        ("POST", "backend/local-ai/test") => (
            StatusCode::OK,
            json!({"ok":true,"response":"Static AI test response. Provider is not configured."}),
        ),
        ("POST", "backend/local-ai/upskill") => (
            StatusCode::OK,
            json!({"plan":[],"source":"static","message":"Configure an AI provider to generate a plan."}),
        ),
        ("POST", "backend/local-ai/settings") => {
            return Err(ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                "AI provider configuration is separate from this demo",
            ));
        }
        ("POST", "job-market/refresh") => {
            return Err(ApiError(
                StatusCode::METHOD_NOT_ALLOWED,
                "Job-market ingestion is controlled by the backend",
            ));
        }
        ("POST", "operations/events") => (StatusCode::ACCEPTED, operational_event(&actor, input)?),
        _ => {
            return Err(ApiError(
                StatusCode::NOT_IMPLEMENTED,
                "Product action is not connected to the Rust API",
            ));
        }
    };
    tracing::info!(event="portal.action.saved", component="portal", operation=%path, actor_id=%actor.id, outcome="success");
    Ok(reply(status, result))
}

fn static_ai(path: &str) -> Value {
    match path {
        "backend/local-ai/status" | "backend/local-ai/settings" => {
            json!({"configured":false,"provider":"static","baseUrl":"","model":"","apiKeyPresent":false,"apiVersion":"","project":"","region":"","middleware":"static","source":"demo-fixture"})
        }
        "backend/local-ai/providers" => {
            json!({"middleware":"static","providers":[{"id":"static","label":"Static test data","modelPlaceholder":"static-demo","apiKeyRequired":false,"baseUrlRequired":false,"help":"AI provider configuration is separate from this demo."}]})
        }
        _ => json!({"configured":false,"provider":"static","model":""}),
    }
}

async fn username_available(db: &SqlitePool, member_id: &str, username: &str) -> ApiResult<bool> {
    if !(3..=24).contains(&username.len())
        || !username
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Ok(false);
    }
    let found: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM portal_state WHERE state_key='/api/member/leaderboard-identity' AND scope != ? AND lower(json_extract(value_json,'$.username'))=lower(?) LIMIT 1")
        .bind(member_id).bind(username).fetch_optional(db).await.map_err(internal)?;
    Ok(found.is_none())
}

async fn privacy(db: &SqlitePool, member_id: &str, input: Value) -> ApiResult<Value> {
    let allowed = [
        "hideGoogleIdentity",
        "hideRealName",
        "deviceCacheEnabled",
        "anonymousRanking",
        "automaticErrorReports",
    ];
    let object = input
        .as_object()
        .ok_or_else(|| bad("Invalid privacy settings"))?;
    if object.len() != allowed.len()
        || allowed
            .iter()
            .any(|key| !object.get(*key).is_some_and(Value::is_boolean))
    {
        return Err(bad("Invalid privacy settings"));
    }
    save(db, member_id, "/api/member/privacy", &input).await?;
    Ok(input)
}

async fn identity(db: &SqlitePool, member_id: &str, role: &str, input: Value) -> ApiResult<Value> {
    let object = input
        .as_object()
        .ok_or_else(|| bad("Invalid leaderboard identity"))?;
    let username = field(&input, "username")?.trim();
    let mode = field(&input, "mode")?;
    let consent = object
        .get("realNameConsent")
        .and_then(Value::as_bool)
        .ok_or_else(|| bad("Invalid leaderboard identity"))?;
    if object.len() != 3
        || !(3..=24).contains(&username.len())
        || !username
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        || !["nickname", "anonymous", "real_name"].contains(&mode)
        || (mode == "real_name" && !consent)
    {
        return Err(bad("Invalid leaderboard identity"));
    }
    if !username_available(db, member_id, username).await? {
        return Err(ApiError(StatusCode::CONFLICT, "Username is unavailable"));
    }
    let mut value = current(db, role, member_id, "/api/member/leaderboard-identity").await?;
    value["username"] = json!(username);
    value["mode"] = json!(mode);
    value["realNameConsent"] = json!(consent);
    value["reviewRequired"] = json!(mode == "real_name");
    value["preview"] = json!(if mode == "anonymous" {
        "Anonymous member"
    } else {
        username
    });
    save(db, member_id, "/api/member/leaderboard-identity", &value).await?;
    Ok(value)
}

async fn demo_action(
    db: &SqlitePool,
    member_id: &str,
    role: &str,
    input: Value,
) -> ApiResult<Value> {
    let action = field(&input, "action")?;
    let id = field(&input, "id")?;
    if !limited(id, 120) {
        return Err(bad("Invalid record ID"));
    }
    let view_key = if action == "approve_review" {
        "/api/product/job-operations"
    } else {
        "/api/product/dashboard"
    };
    let mut view = current(db, role, member_id, view_key).await?;
    let items_key = match action {
        "advance_opportunity" => "opportunities",
        "toggle_event" => "events",
        "approve_review" => "reviews",
        _ => return Err(bad("Unsupported product action")),
    };
    if action == "approve_review" && role != "officer" && role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"));
    }
    let items = if items_key == "reviews" {
        view.pointer_mut("/operations/reviews")
    } else {
        view.get_mut(items_key)
    };
    let items = items
        .and_then(Value::as_array_mut)
        .ok_or_else(|| bad("Product records unavailable"))?;
    let item = items
        .iter_mut()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(id))
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Product record not found"))?;
    match action {
        "advance_opportunity" => {
            let stage = item
                .get("stage")
                .and_then(Value::as_str)
                .unwrap_or("discovered");
            let stages = ["discovered", "drafted", "human_review", "demo_confirmed"];
            let next = stages
                .iter()
                .position(|value| *value == stage)
                .map(|index| stages[(index + 1).min(3)])
                .unwrap_or("drafted");
            item["stage"] = json!(next);
        }
        "toggle_event" => {
            item["registered"] = json!(
                !item
                    .get("registered")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            );
        }
        "approve_review" => {
            item["approved"] = json!(true);
        }
        _ => unreachable!(),
    }
    save(db, member_id, view_key, &view).await?;
    Ok(json!({"ok":true,"state":{"updatedId":id,"action":action}}))
}

async fn overlay_product(db: &SqlitePool, member_id: &str, view: &mut Value) -> ApiResult<()> {
    for (key, property) in [
        ("/api/product/opportunities", "opportunities"),
        ("/api/product/career-evidence", "evidence"),
        ("/api/product/dashboard", "events"),
        ("/api/product/job-operations", "operations"),
    ] {
        if let Some(saved) = stored(db, member_id, key).await? {
            if let Some(value) = saved.get(property) {
                view[property] = value.clone();
            }
        }
    }
    Ok(())
}

async fn opportunity(
    db: &SqlitePool,
    member_id: &str,
    role: &str,
    target: Option<&str>,
    input: Value,
) -> ApiResult<Value> {
    let object = input
        .as_object()
        .ok_or_else(|| bad("Invalid opportunity"))?;
    let required = ["company", "title", "location", "workMode", "stage", "fit"];
    if object.len() < 5
        || object.len() > 7
        || object
            .keys()
            .any(|key| !required.contains(&key.as_str()) && key != "id")
    {
        return Err(bad("Invalid opportunity"));
    }
    let company = field(&input, "company")?.trim();
    let title = field(&input, "title")?.trim();
    let location = input
        .get("location")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let work_mode = field(&input, "workMode")?;
    let stage = field(&input, "stage")?;
    let fit = input.get("fit").and_then(Value::as_i64);
    if !limited(company, 200)
        || !limited(title, 200)
        || location.len() > 200
        || !["remote", "hybrid", "onsite", "any", "unknown"].contains(&work_mode)
        || ![
            "discovered",
            "saved",
            "drafted",
            "human_review",
            "applied",
            "rejected",
            "withdrawn",
            "confirmed",
        ]
        .contains(&stage)
        || fit.is_some_and(|value| !(0..=100).contains(&value))
        || input
            .get("fit")
            .is_some_and(|value| !value.is_null() && fit.is_none())
    {
        return Err(bad("Invalid opportunity"));
    }
    let id = target
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    if Uuid::parse_str(&id).is_err()
        || input
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|value| value != id)
    {
        return Err(bad("Invalid opportunity ID"));
    }
    let mut view = current(db, role, member_id, "/api/product/opportunities").await?;
    let items = view
        .get_mut("opportunities")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| bad("Opportunity view unavailable"))?;
    let record = json!({"id":id,"company":company,"title":title,"location":location,"workMode":work_mode,"stage":stage,"fit":fit,"salaryBand":null,"nextStage":null,"recordOrigin":"manual"});
    if target.is_some() {
        let existing = items
            .iter_mut()
            .find(|item| {
                item.get("id").and_then(Value::as_str) == Some(id.as_str())
                    && item.get("recordOrigin").and_then(Value::as_str) == Some("manual")
            })
            .ok_or(ApiError(
                StatusCode::NOT_FOUND,
                "Manual opportunity not found",
            ))?;
        *existing = record.clone();
    } else {
        items.insert(0, record.clone());
    }
    save(db, member_id, "/api/product/opportunities", &view).await?;
    Ok(json!({"opportunity":record}))
}

async fn feedback_rows(db: &SqlitePool) -> ApiResult<Vec<Value>> {
    let value = stored(db, ORG, "/api/feedback")
        .await?
        .unwrap_or_else(|| json!([]));
    value
        .as_array()
        .cloned()
        .ok_or_else(|| bad("Feedback state invalid"))
}

async fn read_feedback(
    db: &SqlitePool,
    actor: &auth::Viewer,
    query: Option<&str>,
) -> ApiResult<Value> {
    let mut rows = feedback_rows(db).await?;
    if actor.role != "officer" && actor.role != "admin" {
        rows.retain(|item| item.get("reporterId").and_then(Value::as_str) == Some(&actor.id));
    }
    if query.is_some_and(|value| value.contains("paginated=1")) {
        if actor.role != "officer" && actor.role != "admin" {
            return Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"));
        }
        return Ok(json!({"items":rows,"nextCursor":null}));
    }
    Ok(json!(rows))
}

async fn create_feedback(db: &SqlitePool, actor: &auth::Viewer, input: Value) -> ApiResult<Value> {
    let fields = input.as_object().ok_or_else(|| bad("Invalid feedback"))?;
    if fields.len() != 4
        || ["category", "description", "route", "uiState"]
            .iter()
            .any(|key| !fields.contains_key(*key))
    {
        return Err(bad("Invalid feedback fields"));
    }
    let category = field(&input, "category")?;
    let route = field(&input, "route")?;
    let description = input
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");
    let ui = input
        .get("uiState")
        .and_then(Value::as_object)
        .ok_or_else(|| bad("Invalid feedback"))?;
    if ![
        "bug",
        "broken_flow",
        "privacy",
        "security",
        "suggestion",
        "automatic_error",
    ]
    .contains(&category)
        || description.len() > 1200
        || !route.starts_with('/')
        || route.len() > 240
        || ui
            .get("title")
            .and_then(Value::as_str)
            .is_none_or(|value| value.len() > 160)
        || ui.get("online").and_then(Value::as_bool).is_none()
        || ui
            .get("viewport")
            .and_then(Value::as_str)
            .is_none_or(|value| value.len() > 32)
        || ui
            .get("componentMarkers")
            .and_then(Value::as_array)
            .is_none_or(|items| {
                items.len() > 40
                    || items
                        .iter()
                        .any(|item| item.as_str().is_none_or(|text| text.len() > 120))
            })
        || ui
            .get("error")
            .is_some_and(|value| value.as_str().is_none_or(|text| text.len() > 300))
    {
        return Err(bad("Invalid feedback"));
    }
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let mut record = input;
    let object = record
        .as_object_mut()
        .ok_or_else(|| bad("Invalid feedback"))?;
    object.insert("id".into(), json!(id));
    object.insert(
        "portal".into(),
        json!(if actor.role == "officer" || actor.role == "admin" {
            "officer"
        } else {
            "member"
        }),
    );
    object.insert("status".into(), json!("received"));
    object.insert("severity".into(), json!("low"));
    object.insert("reporterId".into(), json!(actor.id));
    object.insert("reporterLabel".into(), json!(actor.display_name));
    object.insert("assignedTo".into(), Value::Null);
    object.insert("resolution".into(), Value::Null);
    object.insert("createdAt".into(), json!(now));
    object.insert("updatedAt".into(), json!(now));
    let mut rows = feedback_rows(db).await?;
    rows.insert(0, record);
    save(db, ORG, "/api/feedback", &json!(rows)).await?;
    Ok(json!({"id":id,"status":"received"}))
}

async fn update_feedback(
    db: &SqlitePool,
    actor: &auth::Viewer,
    id: &str,
    input: Value,
) -> ApiResult<Value> {
    if actor.role != "officer" && actor.role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"));
    }
    let status = field(&input, "status")?;
    let severity = field(&input, "severity")?;
    if ![
        "received",
        "triaged",
        "in_progress",
        "resolved",
        "dismissed",
    ]
    .contains(&status)
        || !["low", "medium", "high", "critical"].contains(&severity)
        || input.get("resolution").is_some_and(|value| {
            !value.is_null() && value.as_str().is_none_or(|text| text.len() > 1200)
        })
        || input.get("assignedTo").is_some_and(|value| {
            !value.is_null()
                && value
                    .as_str()
                    .is_none_or(|text| Uuid::parse_str(text).is_err())
        })
    {
        return Err(bad("Invalid feedback update"));
    }
    let mut rows = feedback_rows(db).await?;
    let row = rows
        .iter_mut()
        .find(|value| value.get("id").and_then(Value::as_str) == Some(id))
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Feedback report not found"))?;
    row["status"] = json!(status);
    row["severity"] = json!(severity);
    row["assignedTo"] = input.get("assignedTo").cloned().unwrap_or(Value::Null);
    row["resolution"] = input.get("resolution").cloned().unwrap_or(Value::Null);
    row["updatedAt"] = json!(chrono::Utc::now().to_rfc3339());
    let result = row.clone();
    save(db, ORG, "/api/feedback", &json!(rows)).await?;
    Ok(result)
}

async fn note_feedback(
    db: &SqlitePool,
    actor: &auth::Viewer,
    id: &str,
    input: Value,
) -> ApiResult<Value> {
    if actor.role != "officer" && actor.role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"));
    }
    let body = field(&input, "body")?.trim();
    if !limited(body, 1200) {
        return Err(bad("Invalid feedback note"));
    }
    let mut rows = feedback_rows(db).await?;
    let row = rows
        .iter_mut()
        .find(|value| value.get("id").and_then(Value::as_str) == Some(id))
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Feedback report not found"))?;
    let note = json!({"id":Uuid::new_v4().to_string(),"body":body,"actorId":actor.id,"createdAt":chrono::Utc::now().to_rfc3339()});
    if !row.get("notes").is_some_and(Value::is_array) {
        row["notes"] = json!([]);
    }
    row["notes"].as_array_mut().unwrap().push(note.clone());
    save(db, ORG, "/api/feedback", &json!(rows)).await?;
    Ok(note)
}

async fn event_rows(db: &SqlitePool, role: &str) -> ApiResult<Vec<Value>> {
    let value = current(db, role, ORG, "/api/events").await?;
    value
        .as_array()
        .cloned()
        .ok_or_else(|| bad("Event state invalid"))
}

async fn read_external_events(db: &SqlitePool, actor: &auth::Viewer) -> ApiResult<Value> {
    let mut rows = event_rows(db, &actor.role).await?;
    for event in &mut rows {
        if let Some(id) = event.get("id").and_then(Value::as_str) {
            let key = format!("/api/event-interest/{id}");
            event["interested"] = json!(stored(db, &actor.id, &key).await?.is_some());
        }
        if actor.role != "officer" && actor.role != "admin" {
            event["emailDraft"] = Value::Null;
        }
    }
    Ok(json!(rows))
}

async fn create_external_event(
    db: &SqlitePool,
    actor: &auth::Viewer,
    input: Value,
) -> ApiResult<Value> {
    let object = input
        .as_object()
        .ok_or_else(|| bad("Invalid external event"))?;
    const FIELDS: [&str; 20] = [
        "title",
        "organizer",
        "summary",
        "category",
        "scope",
        "startAt",
        "endAt",
        "timezone",
        "venue",
        "registrationUrl",
        "registrationDeadline",
        "fee",
        "eligibility",
        "requirements",
        "sourceUrl",
        "scrapedAt",
        "contentHash",
        "scraperVersion",
        "confidence",
        "warnings",
    ];
    if object.len() != FIELDS.len() || FIELDS.iter().any(|name| !object.contains_key(*name)) {
        return Err(bad("Invalid external event fields"));
    }
    let title = field(&input, "title")?.trim();
    let organizer = field(&input, "organizer")?.trim();
    let summary = field(&input, "summary")?.trim();
    let category = field(&input, "category")?;
    let source = field(&input, "sourceUrl")?;
    let hash = field(&input, "contentHash")?;
    if !(3..=200).contains(&title.len())
        || !(2..=200).contains(&organizer.len())
        || !(10..=3000).contains(&summary.len())
        || ![
            "events",
            "workshops",
            "hackathons",
            "competitive-programming",
        ]
        .contains(&category)
        || field(&input, "scope")? != "external"
        || !url::Url::parse(source)
            .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
        || hash.len() != 71
        || !hash.starts_with("sha256:")
        || !hash[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(bad("Invalid external event"));
    }
    for (name, max) in [
        ("startAt", 100),
        ("timezone", 80),
        ("venue", 300),
        ("fee", 120),
        ("scraperVersion", 80),
    ] {
        if !limited(field(&input, name)?, max) {
            return Err(bad("Invalid external event text"));
        }
    }
    for (name, max) in [("endAt", 100), ("registrationDeadline", 100)] {
        if input.get(name).is_some_and(|value| {
            !value.is_null() && value.as_str().is_none_or(|text| text.len() > max)
        }) {
            return Err(bad("Invalid external event date"));
        }
    }
    if input.get("registrationUrl").is_some_and(|value| {
        !value.is_null()
            && value.as_str().is_none_or(|text| {
                text.len() > 2000
                    || !url::Url::parse(text).is_ok_and(|url| {
                        matches!(url.scheme(), "http" | "https") && url.host_str().is_some()
                    })
            })
    }) {
        return Err(bad("Invalid registration URL"));
    }
    if !input
        .get("confidence")
        .and_then(Value::as_f64)
        .is_some_and(|confidence| (0.0..=1.0).contains(&confidence))
        || !limited(field(&input, "scrapedAt")?, 100)
    {
        return Err(bad("Invalid event source"));
    }
    for (name, max_items) in [("eligibility", 20), ("requirements", 30), ("warnings", 20)] {
        if !input.get(name).is_some_and(Value::is_array) {
            return Err(bad("Invalid event list"));
        }
        bounded_strings(input.get(name), max_items, 300)?;
    }
    let departments: &[&str] = match category {
        "events" => &[
            "secretariat",
            "treasurer",
            "external_relations",
            "executive",
        ],
        "workshops" => &["secretariat", "external_relations"],
        "hackathons" => &["secretariat", "treasurer", "external_relations"],
        _ => &["secretariat", "treasurer", "academics"],
    };
    let mut event = input;
    let id = Uuid::new_v4().to_string();
    let fields = event
        .as_object_mut()
        .ok_or_else(|| bad("Invalid external event"))?;
    fields.insert("id".into(), json!(id));
    fields.insert("submittedBy".into(), json!(actor.id));
    fields.insert("submitterLabel".into(), json!(actor.display_name));
    fields.insert("status".into(), json!("department_review"));
    fields.insert("interested".into(), json!(false));
    fields.insert("interestCount".into(), json!(0));
    fields.insert("revision".into(), json!(1));
    fields.insert("requiredDepartments".into(), json!(departments));
    fields.insert("approvedDepartments".into(), json!([]));
    fields.insert("departmentApprovals".into(), json!(0));
    fields.insert("departmentTotal".into(), json!(departments.len()));
    fields.insert("emailDraft".into(), Value::Null);
    fields.insert("sadoReference".into(), Value::Null);
    fields.insert("createdAt".into(), json!(chrono::Utc::now().to_rfc3339()));
    let mut rows = event_rows(db, &actor.role).await?;
    rows.insert(0, event.clone());
    save(db, ORG, "/api/events", &json!(rows)).await?;
    Ok(event)
}

async fn officer_has_department(
    db: &SqlitePool,
    actor: &auth::Viewer,
    department: &str,
) -> ApiResult<bool> {
    if actor.role == "admin" {
        return Ok(true);
    }
    let found: Option<(String,)> =
        sqlx::query_as("SELECT role FROM officer_roles WHERE member_id=? AND role=?")
            .bind(&actor.id)
            .bind(department)
            .fetch_optional(db)
            .await
            .map_err(internal)?;
    Ok(found.is_some())
}

async fn external_event_action(
    db: &SqlitePool,
    actor: &auth::Viewer,
    id: &str,
    input: Value,
) -> ApiResult<Value> {
    let action = field(&input, "action")?;
    let mut rows = event_rows(db, &actor.role).await?;
    let event = rows
        .iter_mut()
        .find(|value| value.get("id").and_then(Value::as_str) == Some(id))
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Event not found"))?;
    if action == "interest" {
        let key = format!("/api/event-interest/{id}");
        if stored(db, &actor.id, &key).await?.is_none() {
            save(db, &actor.id, &key, &json!(true)).await?;
            event["interestCount"] = json!(
                event
                    .get("interestCount")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    + 1
            );
        }
        let mut result = event.clone();
        save(db, ORG, "/api/events", &json!(rows)).await?;
        result["interested"] = json!(true);
        if actor.role != "officer" && actor.role != "admin" {
            result["emailDraft"] = Value::Null;
        }
        return Ok(result);
    }
    if actor.role != "officer" && actor.role != "admin" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"));
    }
    let status = event
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    match action {
        "approve_department" => {
            if status != "department_review" {
                return Err(bad("Event is not in department review"));
            }
            let required = event
                .get("requiredDepartments")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| bad("Event departments unavailable"))?;
            let mut approved = event
                .get("approvedDepartments")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let department =
                if let Some(requested) = input.get("department").and_then(Value::as_str) {
                    requested.to_owned()
                } else {
                    let mut selected = None;
                    for value in &required {
                        if let Some(candidate) = value.as_str() {
                            if !approved.iter().any(|item| item.as_str() == Some(candidate))
                                && officer_has_department(db, actor, candidate).await?
                            {
                                selected = Some(candidate.to_owned());
                                break;
                            }
                        }
                    }
                    selected.ok_or(ApiError(
                        StatusCode::FORBIDDEN,
                        "No permitted department remains",
                    ))?
                };
            if !required
                .iter()
                .any(|item| item.as_str() == Some(&department))
                || !officer_has_department(db, actor, &department).await?
            {
                return Err(ApiError(
                    StatusCode::FORBIDDEN,
                    "Department approval not permitted",
                ));
            }
            if !approved
                .iter()
                .any(|item| item.as_str() == Some(&department))
            {
                approved.push(json!(department));
            }
            let done = approved.len() == required.len();
            let count = approved.len();
            event["approvedDepartments"] = json!(approved);
            event["departmentApprovals"] = json!(count);
            if done {
                let title = event["title"].as_str().unwrap_or("event").to_owned();
                let hash = event["contentHash"].clone();
                event["status"] = json!("email_review");
                event["emailDraft"] = json!({"subject":format!("Event endorsement: {title}"),"body":"Static draft for human review. No email was sent.","revisionHash":hash,"deliveryMode":"copy_export","deliveryStatus":"pending"});
            }
        }
        "approve_email" => {
            if status != "email_review" || !officer_has_department(db, actor, "secretariat").await?
            {
                return Err(ApiError(
                    StatusCode::FORBIDDEN,
                    "Email approval not permitted",
                ));
            }
            event["emailDraft"]["deliveryStatus"] = json!("exported");
        }
        "confirm_manual_delivery" => {
            let detail = field(&input, "detail")?;
            if status != "email_review"
                || !limited(detail, 500)
                || detail.len() < 4
                || event
                    .pointer("/emailDraft/deliveryStatus")
                    .and_then(Value::as_str)
                    != Some("exported")
            {
                return Err(bad("Manual delivery is not ready"));
            }
            event["status"] = json!("submitted_to_sado");
            event["emailDraft"]["deliveryStatus"] = json!("sent");
        }
        "record_sado_approval" => {
            let detail = field(&input, "detail")?;
            if status != "submitted_to_sado" || !limited(detail, 500) || detail.len() < 4 {
                return Err(bad("SADO approval is not ready"));
            }
            event["status"] = json!("sado_approved");
            event["sadoReference"] = json!(detail);
        }
        _ => return Err(bad("Unsupported event action")),
    }
    event["revision"] = json!(event.get("revision").and_then(Value::as_i64).unwrap_or(1) + 1);
    let result = event.clone();
    save(db, ORG, "/api/events", &json!(rows)).await?;
    Ok(result)
}

fn bounded_strings(
    value: Option<&Value>,
    max_items: usize,
    max_length: usize,
) -> ApiResult<Vec<String>> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let items = value
        .as_array()
        .ok_or_else(|| bad("Invalid evidence list"))?;
    if items.len() > max_items {
        return Err(bad("Too many evidence values"));
    }
    items
        .iter()
        .map(|item| {
            let text = item
                .as_str()
                .ok_or_else(|| bad("Invalid evidence value"))?
                .trim();
            if text.len() > max_length {
                return Err(bad("Evidence value is too long"));
            }
            Ok(text.to_owned())
        })
        .collect()
}

pub async fn media(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let actor = auth::viewer(&state, &headers).await?;
    if Uuid::parse_str(&id).is_err() {
        return Err(ApiError(StatusCode::NOT_FOUND, "Media not found"));
    }
    let row: Option<(Vec<u8>,)> =
        sqlx::query_as("SELECT bytes FROM portal_media WHERE id=? AND owner_id=?")
            .bind(id)
            .bind(actor.id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    let bytes = row
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Media not found"))?
        .0;
    Ok((
        [
            ("content-type", "image/jpeg"),
            ("cache-control", "private, no-store"),
            ("x-content-type-options", "nosniff"),
        ],
        bytes,
    )
        .into_response())
}

async fn product_photo(state: &AppState, actor: &auth::Viewer, input: Value) -> ApiResult<Value> {
    let title = field(&input, "title")?.trim();
    let photo = field(&input, "photoData")?;
    if !limited(title, 200) || photo.len() > 350_000 {
        return Err(bad("Invalid evidence photo"));
    }
    let encoded = photo
        .strip_prefix("data:image/jpeg;base64,")
        .ok_or_else(|| bad("Evidence photo must be JPEG"))?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| bad("Invalid JPEG encoding"))?;
    if !(100..=262_144).contains(&bytes.len())
        || !bytes.starts_with(&[0xff, 0xd8, 0xff])
        || !bytes.ends_with(&[0xff, 0xd9])
    {
        return Err(bad("Invalid JPEG photo"));
    }
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM portal_media WHERE owner_id=?")
        .bind(&actor.id)
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;
    if count.0 >= 50 {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Evidence photo limit reached",
        ));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO portal_media(id,owner_id,mime,bytes,created_at) VALUES (?,?,?,?,?)")
        .bind(&id)
        .bind(&actor.id)
        .bind("image/jpeg")
        .bind(bytes)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db)
        .await
        .map_err(internal)?;
    let origin = state.public_api_origin.trim_end_matches('/');
    let item = json!({"item":{"title":title,"organization":"","role":"","dateLabel":chrono::Utc::now().format("%B %Y").to_string(),"description":"","quantitative":[],"qualitative":[],"skills":[],"mediaUrl":format!("{origin}/portal/media/{id}"),"mediaAlt":format!("User-selected evidence photo: {title}"),"verificationState":"draft"}});
    match product_evidence(&state.db, &actor.id, &actor.role, None, item).await {
        Ok(value) => Ok(json!({"item":value["item"],"metadataStripped":true})),
        Err(error) => {
            let _ = sqlx::query("DELETE FROM portal_media WHERE id=? AND owner_id=?")
                .bind(id)
                .bind(&actor.id)
                .execute(&state.db)
                .await;
            Err(error)
        }
    }
}

async fn product_evidence(
    db: &SqlitePool,
    member_id: &str,
    role: &str,
    target: Option<&str>,
    input: Value,
) -> ApiResult<Value> {
    let supplied = input
        .get("item")
        .ok_or_else(|| bad("Evidence item required"))?;
    let title = field(supplied, "title")?.trim();
    let source = supplied
        .get("sourceUrl")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !limited(title, 200)
        || (!source.is_empty()
            && !url::Url::parse(source).is_ok_and(|url| {
                matches!(url.scheme(), "http" | "https") && url.host_str().is_some()
            }))
        || source.len() > 2000
    {
        return Err(bad("Invalid evidence item"));
    }
    let text = |key: &str, max: usize| -> ApiResult<String> {
        let value = supplied
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if value.len() > max {
            return Err(bad("Evidence field is too long"));
        }
        Ok(value.to_owned())
    };
    let id = target
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    if Uuid::parse_str(&id).is_err() {
        return Err(bad("Invalid evidence ID"));
    }
    let media = supplied
        .get("mediaUrl")
        .and_then(Value::as_str)
        .unwrap_or("/demo/evidence/manual-placeholder.svg");
    if media.len() > 4000 || !(media.starts_with('/') || media.starts_with("https://")) {
        return Err(bad("Invalid evidence media URL"));
    }
    let state = if input.get("approve").and_then(Value::as_bool) == Some(true) {
        "user_verified"
    } else {
        "draft"
    };
    let media_alt = supplied
        .get("mediaAlt")
        .and_then(Value::as_str)
        .unwrap_or("Manual evidence");
    if media_alt.len() > 300 {
        return Err(bad("Evidence media description is too long"));
    }
    let item = json!({
        "id":id,"sourceId":"manual","evidenceKind":supplied.get("evidenceKind").and_then(Value::as_str).filter(|kind| *kind == "experience").unwrap_or("project"),
        "collectionOrigin":"manual","title":title,"organization":text("organization",200)?,"role":text("role",200)?,
        "dateLabel":text("dateLabel",100)?,"description":text("description",5000)?,
        "quantitative":bounded_strings(supplied.get("quantitative"),25,500)?,"qualitative":bounded_strings(supplied.get("qualitative"),25,500)?,
        "skills":bounded_strings(supplied.get("skills"),50,100)?,"mediaUrl":media,
        "mediaAlt":media_alt,
        "verificationState":state,"sourceUrl":source,
    });
    let mut view = current(db, role, member_id, "/api/product/career-evidence").await?;
    let items = view
        .pointer_mut("/evidence/items")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| bad("Evidence view unavailable"))?;
    if target.is_some() {
        let record = items
            .iter_mut()
            .find(|record| {
                record.get("id").and_then(Value::as_str) == Some(id.as_str())
                    && record.get("sourceId").and_then(Value::as_str) == Some("manual")
            })
            .ok_or(ApiError(StatusCode::NOT_FOUND, "Manual evidence not found"))?;
        *record = item.clone();
    } else {
        items.insert(0, item.clone());
    }
    save(db, member_id, "/api/product/career-evidence", &view).await?;
    Ok(json!({"item":item}))
}

async fn product_source(
    db: &SqlitePool,
    member_id: &str,
    role: &str,
    id: &str,
    input: Value,
) -> ApiResult<Value> {
    if ![
        "github",
        "facebook",
        "linkedin",
        "twitter",
        "instagram",
        "website",
    ]
    .contains(&id)
    {
        return Err(bad("Unknown evidence source"));
    }
    let action = field(&input, "action")?;
    if !["connect", "sync", "disconnect"].contains(&action) {
        return Err(bad("Invalid source action"));
    }
    if action == "disconnect" && input.get("confirmation").and_then(Value::as_bool) != Some(true) {
        return Err(bad("Disconnect confirmation required"));
    }
    let link = input.get("url").and_then(Value::as_str).unwrap_or("");
    if !link.is_empty()
        && (link.len() > 2000
            || !url::Url::parse(link)
                .is_ok_and(|url| url.scheme() == "https" && url.host_str().is_some()))
    {
        return Err(bad("Invalid source URL"));
    }
    if id == "website" && action == "connect" && link.is_empty() {
        return Err(bad("Portfolio URL is required"));
    }
    let mut view = current(db, role, member_id, "/api/product/career-evidence").await?;
    let sources = view
        .pointer_mut("/evidence/sources")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| bad("Evidence sources unavailable"))?;
    let source = sources
        .iter_mut()
        .find(|source| source.get("id").and_then(Value::as_str) == Some(id))
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Source not found"))?;
    source["connectionStatus"] = json!(if action == "disconnect" {
        "disconnected"
    } else {
        "connected"
    });
    source["status"] = json!(if action == "disconnect" {
        "ready"
    } else {
        "verified"
    });
    if action != "disconnect" {
        source["lastSyncedAt"] = json!(chrono::Utc::now().to_rfc3339());
    }
    if !link.is_empty() {
        source["configuredUrl"] = json!(link);
    }
    if action == "disconnect" {
        source["configuredUrl"] = Value::Null;
    }
    let result = source.clone();
    save(db, member_id, "/api/product/career-evidence", &view).await?;
    Ok(json!({"source":result}))
}

fn static_evidence_analysis(input: Value) -> ApiResult<Value> {
    if input.get("consent").and_then(Value::as_bool) != Some(true) {
        return Err(bad("Explicit per-analysis consent is required"));
    }
    let id = field(&input, "evidenceId")?;
    let current = input
        .get("current")
        .ok_or_else(|| bad("Current evidence is required"))?;
    let title = field(current, "title")?;
    if !limited(id, 100) || !limited(title, 200) {
        return Err(bad("A selected evidence item is required"));
    }
    let before = current
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");
    if before.len() > 5000 {
        return Err(bad("Evidence description is too long"));
    }
    Ok(
        json!({"proposal":{"summary":"Static evidence review. No external AI provider was contacted.","changes":[{"field":"Description","before":before,"after":if before.is_empty() { "Describe the demonstrated outcome without adding unsupported metrics." } else { before }}],"warnings":["Static test data only; verify all claims against their sources."]},"provider":"static-fixture","userApprovalRequired":true}),
    )
}

fn operational_event(actor: &auth::Viewer, input: Value) -> ApiResult<Value> {
    for key in ["eventId", "correlationId"] {
        if Uuid::parse_str(field(&input, key)?).is_err() {
            return Err(bad("Invalid operational event ID"));
        }
    }
    if input.get("retryable").and_then(Value::as_bool).is_none()
        || input
            .get("occurredAt")
            .and_then(Value::as_str)
            .is_none_or(|value| chrono::DateTime::parse_from_rfc3339(value).is_err())
        || !field(&input, "route")?.starts_with('/')
    {
        return Err(bad("Invalid operational event metadata"));
    }
    let component = field(&input, "component")?;
    let stage = field(&input, "stage")?;
    let code = field(&input, "code")?;
    let severity = field(&input, "severity")?;
    let outcome = field(&input, "outcome")?;
    if ![component, stage, code].iter().all(|value| {
        (2..=120).contains(&value.len())
            && value.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_.-".contains(&byte)
            })
    }) || !["info", "warning", "error", "critical"].contains(&severity)
        || !["succeeded", "stopped", "failed"].contains(&outcome)
    {
        return Err(bad("Invalid operational event"));
    }
    tracing::info!(event="portal.client.operation", component=%component, stage=%stage, code=%code, severity=%severity, outcome=%outcome, actor_id=%actor.id);
    Ok(json!({"accepted":true}))
}
