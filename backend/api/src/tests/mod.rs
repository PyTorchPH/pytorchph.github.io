//! End-to-end behaviour of the API modules against an in-memory database.
//!
//! Module map:
//!   mod.rs        shared fixtures: fixture, member_session, portal_call, portal_get, send,
//!                 count, table_counts, claim, echo, admission_app, tight
//!   identity      sessions, email sign-up, account deletion, verified accounts
//!   portal_gateway gateway settings, officer elevation, owner-only media
//!   officer       Command Center analytics
//!   feedback      bug-report attachments
//!   evidence      review, sanctions, appeals, manual evidence queue
//!   leaderboard_visibility achievements visibility
//!   event_results official results and entrant rules
//!   admission_queue RAM priority queue, disk spool, replay, recovery
//!   member_profile reserved officer seats, onboarding profile, demographics
//!   migrations    cascading deletes
//!   seed          sample members and demo fixtures
#![allow(clippy::too_many_lines)]
use crate::{
    ApiError, AppState,
    app::jobs::process_one_job,
    events,
    http::admission,
    identity::{email_signup, session},
    portal,
    seed::{demo, sample},
};
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, Method, StatusCode},
    routing::{get, post},
};
use axum::{
    body::Bytes,
    extract::{OriginalUri, Path},
};
use sha2::{Digest, Sha256};
use sqlx::sqlite::SqlitePoolOptions;
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

mod admission_queue;
mod event_results;
mod evidence;
mod feedback;
mod identity;
mod leaderboard_visibility;
mod member_profile;
mod migrations;
mod officer;
mod portal_gateway;
mod seed;

async fn fixture() -> (Arc<AppState>, HeaderMap, String, String) {
    let db = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!().run(&db).await.unwrap();
    // One directory row so profile tests need not load the whole school seed.
    sqlx::query("INSERT INTO schools(code,name,acronym,level,sector,city,province,region_code) VALUES ('test-school','Test Institute of Technology','TIT','higher','private','Lucena City','Quezon','04')")
        .execute(&db)
        .await
        .unwrap();
    // A few catalog programs, one per level the profile tests use.
    sqlx::query("INSERT INTO programs(code,level,name,short_name,group_name) VALUES ('test-bscs','undergraduate','Bachelor of Science in Computer Science','BSCS','Software'), ('test-stem','senior_high','Science, Technology, Engineering, and Mathematics','STEM','Academic track'), ('test-ste','junior_high','Science, Technology, and Engineering','STE','Special curricular program')")
        .execute(&db)
        .await
        .unwrap();
    let officer = Uuid::new_v4().to_string();
    let member = Uuid::new_v4().to_string();
    for (id, role) in [(&officer, "officer"), (&member, "member")] {
        sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,?,?)")
            .bind(id).bind(id).bind(format!("{id}@example.test")).bind("Test Member")
            .bind(format!("Member-{}", &id[..8])).bind(role).bind(chrono::Utc::now().to_rfc3339())
            .execute(&db).await.unwrap();
    }
    let token = "a".repeat(64);
    sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
        .bind(hex::encode(Sha256::digest(token.as_bytes())))
        .bind(&officer)
        .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
        .execute(&db)
        .await
        .unwrap();
    let state = Arc::new(AppState {
        db,
        google_client_id: "test".into(),
        bootstrap_admin_email: "admin@example.test".into(),
        allowed_origin: "https://pytorch.ph".into(),
        public_api_origin: "https://api.pytorch.ph".into(),
        http: reqwest::Client::new(),
        google_keys: tokio::sync::Mutex::new(None),
        workflow_key: None,
        live_email_enabled: false,
        google_forms_client_id: None,
        google_forms_client_secret: None,
        google_forms_refresh_token: None,
        email_code_secret: "test-secret-only".into(),
        mail_relay: None,
        password_slots: tokio::sync::Semaphore::new(2),
    });
    let mut headers = HeaderMap::new();
    headers.insert("origin", "https://pytorch.ph".parse().unwrap());
    headers.insert("cookie", format!("ph_session={token}").parse().unwrap());
    (state, headers, officer, member)
}

async fn member_session(
    state: &Arc<AppState>,
    base: &HeaderMap,
    member_id: &str,
    token: &str,
) -> HeaderMap {
    sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
        .bind(hex::encode(Sha256::digest(token.as_bytes())))
        .bind(member_id)
        .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
        .execute(&state.db)
        .await
        .unwrap();
    let mut headers = base.clone();
    headers.insert("cookie", format!("ph_session={token}").parse().unwrap());
    headers
}

async fn portal_call(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    method: Method,
    uri: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let path = uri
        .trim_start_matches("/portal/api/")
        .split('?')
        .next()
        .unwrap()
        .to_owned();
    match portal::gateway(
        State(state.clone()),
        Path(path),
        OriginalUri(uri.parse().unwrap()),
        method,
        headers.clone(),
        Bytes::from(body.to_string()),
    )
    .await
    {
        Ok(response) => {
            let status = response.status();
            let bytes = axum::body::to_bytes(response.into_body(), 1 << 22)
                .await
                .unwrap();
            (
                status,
                serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
            )
        }
        Err(ApiError(status, message)) => (status, serde_json::json!({ "error": message })),
    }
}

async fn portal_get(state: &Arc<AppState>, headers: &HeaderMap, path: &str) -> serde_json::Value {
    let response = portal::gateway(
        State(state.clone()),
        Path(path.to_owned()),
        OriginalUri(format!("/portal/api/{path}").parse().unwrap()),
        Method::GET,
        headers.clone(),
        Bytes::new(),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 1 << 22)
        .await
        .unwrap();
    serde_json::from_slice(&body).unwrap()
}

async fn send(
    app: &Router,
    method: Method,
    uri: &str,
    headers: &HeaderMap,
    body: &str,
) -> (StatusCode, HeaderMap, serde_json::Value, String) {
    use tower::ServiceExt;
    let mut request = axum::http::Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    let response = app
        .clone()
        .oneshot(
            request
                .body(axum::body::Body::from(body.to_owned()))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, headers) = (response.status(), response.headers().clone());
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    let text = String::from_utf8_lossy(&bytes).to_string();
    (
        status,
        headers,
        serde_json::from_str(&text).unwrap_or(serde_json::Value::Null),
        text,
    )
}

async fn count(db: &sqlx::SqlitePool, sql: &str) -> i64 {
    // Test-only SQL built from fixed literals and table names read from sqlite_master.
    sqlx::query_as::<_, (i64,)>(sqlx::AssertSqlSafe(sql.to_owned()))
        .fetch_one(db)
        .await
        .unwrap()
        .0
}

async fn table_counts(db: &sqlx::SqlitePool) -> Vec<(String, i64)> {
    let tables: Vec<(String,)> = sqlx::query_as(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_sqlx_migrations' ORDER BY name",
    )
    .fetch_all(db)
    .await
    .unwrap();
    let mut counts = Vec::new();
    for (name,) in tables {
        counts.push((
            name.clone(),
            count(db, &format!("SELECT COUNT(*) FROM \"{name}\"")).await,
        ));
    }
    counts
}

async fn claim(state: &Arc<AppState>, id: &str, member: &str, origin: &str) {
    sqlx::query("INSERT INTO evidence_claims(id,member_id,kind,title,source_url,origin,content_hash,status,created_at) VALUES (?,?,'external_talk','Talk','https://example.test/talk',?,?,'pending',?)")
        .bind(id).bind(member).bind(origin).bind(format!("hash-{id}")).bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db).await.unwrap();
}

async fn echo(State(state): State<Arc<AppState>>, headers: HeaderMap, body: Bytes) -> String {
    let who = session::viewer(&state, &headers)
        .await
        .map(|viewer| viewer.id)
        .unwrap_or_else(|_| "anon".into());
    format!("{who}:{}", String::from_utf8_lossy(&body))
}

fn admission_app(
    state: &Arc<AppState>,
    config: admission::Config,
) -> (Arc<admission::Admission>, Router) {
    let gate = admission::Admission::new(config, state.clone());
    let app = Router::new()
        .route("/echo", post(echo))
        .route("/auth/echo", post(echo))
        .route("/queue/{id}", get(admission::queue_status))
        .layer(axum::middleware::from_fn_with_state(
            gate.clone(),
            admission::admit,
        ))
        .with_state(state.clone());
    (gate, app)
}

fn tight(spool_max_bytes: i64) -> admission::Config {
    admission::Config {
        max_inflight: 1,
        ram_queue_depth: 0,
        spool_max_bytes,
        result_ttl_hours: 24,
        spool_workers: 1,
    }
}
