mod attendance;
mod auth;
mod auth_email;
mod demo;
mod events;
mod evidence;
mod mail;
mod pdf;
mod portal;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get, post},
};
use serde::Serialize;
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use std::{env, net::SocketAddr, str::FromStr, sync::Arc, time::Duration};
use tower_http::{cors::CorsLayer, limit::RequestBodyLimitLayer, trace::TraceLayer};
use tracing::{error, info};

struct AppState {
    db: SqlitePool,
    google_client_id: String,
    bootstrap_admin_email: String,
    allowed_origin: String,
    public_api_origin: String,
    http: reqwest::Client,
    google_keys: tokio::sync::Mutex<Option<(std::time::Instant, jsonwebtoken::jwk::JwkSet)>>,
    workflow_key: Option<String>,
    live_email_enabled: bool,
    google_forms_client_id: Option<String>,
    google_forms_client_secret: Option<String>,
    google_forms_refresh_token: Option<String>,
    email_code_secret: String,
    mail_relay: Option<auth_email::RelayConfig>,
    password_slots: tokio::sync::Semaphore,
}

#[derive(Debug)]
struct ApiError(StatusCode, &'static str);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({"error": self.1}))).into_response()
    }
}

type ApiResult<T> = Result<T, ApiError>;

fn internal(error: impl std::fmt::Display) -> ApiError {
    error!(error = %error, "api.internal_error");
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, "Internal error")
}

fn bad(message: &'static str) -> ApiError {
    ApiError(StatusCode::UNPROCESSABLE_ENTITY, message)
}

fn check_origin(state: &AppState, headers: &HeaderMap) -> ApiResult<()> {
    if headers.get("origin").and_then(|v| v.to_str().ok()) == Some(state.allowed_origin.as_str()) {
        Ok(())
    } else {
        Err(ApiError(StatusCode::FORBIDDEN, "Invalid origin"))
    }
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
}

async fn health() -> Json<Health> {
    Json(Health { status: "ok" })
}

#[derive(Serialize)]
struct JobView {
    id: String,
    status: String,
    result: Option<String>,
}

async fn read_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<JobView>> {
    let actor = auth::viewer(&state, &headers).await?;
    let row: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, status, result FROM jobs WHERE id = ? AND ((kind = 'leaderboard_refresh' AND ? != 'pending') OR entity_id IN (SELECT id FROM events WHERE created_by = ?) OR ? = 'admin')"
    ).bind(&id).bind(&actor.role).bind(&actor.id).bind(&actor.role).fetch_optional(&state.db).await.map_err(internal)?;
    let Some((id, status, result)) = row else {
        return Err(ApiError(StatusCode::NOT_FOUND, "Job not found"));
    };
    Ok(Json(JobView { id, status, result }))
}

async fn worker(db: SqlitePool) {
    loop {
        if let Err(error) = process_one_job(&db).await {
            error!(error = %error, "worker.job_failed");
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

async fn process_one_job(db: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let job: Option<(String, String, i64)> = sqlx::query_as(
        "SELECT id, kind, generation FROM jobs WHERE status = 'pending' AND available_at <= ? ORDER BY created_at LIMIT 1"
    ).bind(chrono::Utc::now().to_rfc3339()).fetch_optional(&mut *tx).await?;
    let Some((id, kind, generation)) = job else {
        return Ok(());
    };
    sqlx::query("UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    if kind == "leaderboard_refresh" {
        let mut tx = db.begin().await?;
        sqlx::query("DELETE FROM leaderboard_cache")
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO leaderboard_cache(member_id, points, refreshed_at) SELECT member_id, SUM(delta), ? FROM point_ledger GROUP BY member_id")
            .bind(chrono::Utc::now().to_rfc3339()).execute(&mut *tx).await?;
        sqlx::query(
            "UPDATE jobs SET status = 'done', finished_at = ?, result = 'refreshed' WHERE id = ? AND generation = ?",
        )
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(&id)
        .bind(generation)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        info!(job_id = %id, "worker.job_done");
    } else {
        sqlx::query("UPDATE jobs SET status = 'failed', finished_at = ?, result = 'Unsupported job type' WHERE id = ? AND generation = ?")
            .bind(chrono::Utc::now().to_rfc3339()).bind(&id).bind(generation).execute(db).await?;
    }
    Ok(())
}

async fn leaderboard(State(state): State<Arc<AppState>>) -> ApiResult<impl IntoResponse> {
    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT m.id, m.public_handle, c.points FROM leaderboard_cache c JOIN members m ON m.id = c.member_id WHERE m.role != 'pending' ORDER BY c.points DESC, m.id ASC LIMIT 100"
    ).fetch_all(&state.db).await.map_err(internal)?;
    let mut prior_points = None;
    let mut peer_rank = 0;
    let body: Vec<_> = rows.into_iter().enumerate().map(|(i, (member_id, display_name, points))| {
        if prior_points != Some(points) { peer_rank = i + 1; }
        prior_points = Some(points);
        serde_json::json!({"rank": peer_rank, "memberId": member_id, "displayName": display_name, "points": points})
    }).collect();
    let mut response = Json(body).into_response();
    response.headers_mut().insert(
        "cache-control",
        HeaderValue::from_static("public, max-age=30"),
    );
    Ok(response)
}

async fn public_events(State(state): State<Arc<AppState>>) -> ApiResult<impl IntoResponse> {
    let rows: Vec<(String, String, String, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id,title,category,starts_at,parent_id,published_at FROM events ORDER BY starts_at DESC LIMIT 100"
    ).fetch_all(&state.db).await.map_err(internal)?;
    let body: Vec<_> = rows.into_iter().map(|(id,title,category,starts_at,parent_id,published_at)| {
        serde_json::json!({"id": id, "title": title, "category": category, "startsAt": starts_at, "parentId": parent_id, "publishedAt": published_at})
    }).collect();
    Ok(Json(body))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pytorch_ph_api=info,tower_http=warn".into()),
        )
        .init();
    let database_url = env::var("DATABASE_URL")?;
    let allowed_origin = env::var("ALLOWED_ORIGIN")?;
    let options = SqliteConnectOptions::from_str(&database_url)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let db = SqlitePoolOptions::new()
        .max_connections(3)
        .connect_with(options)
        .await?;
    sqlx::migrate!().run(&db).await?;
    demo::seed(&db).await?;
    if env::var("SEED_TEMP_TEST_ACCOUNTS").ok().as_deref() == Some("true") {
        let password = env::var("TEMP_TEST_PASSWORD")?;
        auth_email::seed_test_accounts(&db, &password).await?;
    }
    sqlx::query(
        "UPDATE jobs SET status='pending' WHERE status='running' AND kind='leaderboard_refresh'",
    )
    .execute(&db)
    .await?;
    let state = Arc::new(AppState {
        db: db.clone(),
        google_client_id: env::var("GOOGLE_CLIENT_ID")?,
        bootstrap_admin_email: env::var("BOOTSTRAP_ADMIN_EMAIL")?,
        allowed_origin: allowed_origin.clone(),
        public_api_origin: env::var("APP_PUBLIC_ORIGIN")
            .unwrap_or_else(|_| "https://api.pytorch.ph".to_owned()),
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .build()?,
        google_keys: tokio::sync::Mutex::new(None),
        workflow_key: env::var("N8N_SHARED_KEY").ok(),
        live_email_enabled: env::var("ENABLE_LIVE_EMAIL").ok().as_deref() == Some("true"),
        google_forms_client_id: env::var("GOOGLE_FORMS_CLIENT_ID").ok(),
        google_forms_client_secret: env::var("GOOGLE_FORMS_CLIENT_SECRET").ok(),
        google_forms_refresh_token: env::var("GOOGLE_FORMS_REFRESH_TOKEN").ok(),
        email_code_secret: env::var("EMAIL_CODE_SECRET")?,
        mail_relay: auth_email::RelayConfig::from_env()?,
        password_slots: tokio::sync::Semaphore::new(2),
    });
    tokio::spawn(worker(db));
    let cors = CorsLayer::new()
        .allow_origin(allowed_origin.parse::<HeaderValue>()?)
        .allow_credentials(true)
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::IF_MATCH,
        ])
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH]);
    let app = Router::new()
        .route("/health", get(health))
        .route("/demo/fixtures", get(demo::fixtures))
        .route("/portal/api/{*path}", any(portal::gateway))
        .route("/portal/media/{id}", get(portal::media))
        .route("/auth/google", post(auth::google_login))
        .route("/auth/email/start", post(auth_email::start_signup))
        .route("/auth/email/verify", post(auth_email::verify_signup))
        .route("/auth/password", post(auth_email::password_login))
        .route("/auth/me", get(auth::me))
        .route("/auth/signout", post(auth::signout))
        .route("/members", get(auth::list_members))
        .route("/members/{id}/approve", post(auth::approve_member))
        .route(
            "/events",
            post(events::create_event).get(events::list_events),
        )
        .route(
            "/events/{id}/entrants",
            post(events::add_entrant).get(events::list_entrants),
        )
        .route(
            "/events/{id}/results",
            post(events::publish_results).get(events::read_event),
        )
        .route("/jobs/{id}", get(read_job))
        .route("/leaderboard", get(leaderboard))
        .route("/public/events", get(public_events))
        .route("/events/{id}/attendance", get(attendance::read_attendance))
        .route(
            "/events/{id}/attendance/import",
            post(attendance::import_google_form),
        )
        .route("/evidence", post(evidence::submit_claim))
        .route("/evidence/extension", post(evidence::submit_extension))
        .route("/evidence/me", get(evidence::my_claims))
        .route("/evidence/pending", get(evidence::pending_claims))
        .route("/evidence/{id}/review", post(evidence::review_claim))
        .route("/members/{id}/officer-roles", post(mail::set_officer_roles))
        .route("/mail/routes/{category}", post(mail::set_route))
        .route("/mail/drafts", post(mail::create_draft))
        .route(
            "/mail/drafts/{id}",
            get(mail::read_draft).patch(mail::edit_draft),
        )
        .route("/mail/drafts/{id}/approve", post(mail::approve_draft))
        .route("/mail/drafts/{id}/release", post(mail::release_draft))
        .route(
            "/mail/drafts/{id}/reconcile",
            post(mail::reconcile_dispatch),
        )
        .route("/mail/drafts/{id}/pdf", get(mail::preview_pdf))
        .route("/internal/mail/claim", post(mail::claim_dispatch))
        .route("/internal/mail/{id}/pdf", get(mail::dispatch_pdf))
        .route("/internal/mail/{id}/receipt", post(mail::record_receipt))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth::refresh_session,
        ))
        .layer(RequestBodyLimitLayer::new(384 * 1024))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);
    let bind = env::var("APP_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_owned());
    let address: SocketAddr = bind.parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    info!(address = %address, "api.started");
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Bytes,
        extract::{OriginalUri, Path},
    };
    use sha2::{Digest, Sha256};
    use uuid::Uuid;

    #[tokio::test]
    async fn portal_gateway_persists_private_settings_and_rejects_cross_role_access() {
        let (state, officer_headers, _, member_id) = fixture().await;
        let settings = serde_json::json!({"hideGoogleIdentity":true,"hideRealName":false,"deviceCacheEnabled":true,"anonymousRanking":false,"automaticErrorReports":true});
        let put = portal::gateway(
            State(state.clone()),
            Path("member/privacy".to_owned()),
            OriginalUri("/portal/api/member/privacy".parse().unwrap()),
            Method::PUT,
            officer_headers.clone(),
            Bytes::from(settings.to_string()),
        )
        .await
        .unwrap();
        assert_eq!(put.status(), StatusCode::OK);
        let get = portal::gateway(
            State(state.clone()),
            Path("member/privacy".to_owned()),
            OriginalUri("/portal/api/member/privacy".parse().unwrap()),
            Method::GET,
            officer_headers.clone(),
            Bytes::new(),
        )
        .await
        .unwrap();
        let body = axum::body::to_bytes(get.into_body(), 65536).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            settings
        );

        let token = "b".repeat(64);
        sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
            .bind(hex::encode(Sha256::digest(token.as_bytes())))
            .bind(&member_id)
            .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
            .execute(&state.db)
            .await
            .unwrap();
        let mut member_headers = officer_headers.clone();
        member_headers.insert("cookie", format!("ph_session={token}").parse().unwrap());
        let member_get = portal::gateway(
            State(state.clone()),
            Path("member/privacy".to_owned()),
            OriginalUri("/portal/api/member/privacy".parse().unwrap()),
            Method::GET,
            member_headers.clone(),
            Bytes::new(),
        )
        .await
        .unwrap();
        let body = axum::body::to_bytes(member_get.into_body(), 65536)
            .await
            .unwrap();
        assert_ne!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            settings
        );
        let officer_only = portal::gateway(
            State(state),
            Path("officer/evidence".to_owned()),
            OriginalUri("/portal/api/officer/evidence".parse().unwrap()),
            Method::GET,
            member_headers,
            Bytes::new(),
        )
        .await;
        assert!(matches!(
            officer_only,
            Err(ApiError(StatusCode::FORBIDDEN, _))
        ));
    }

    async fn portal_get(
        state: &Arc<AppState>,
        headers: &HeaderMap,
        path: &str,
    ) -> serde_json::Value {
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

    #[tokio::test]
    async fn officer_is_an_elevated_member_and_career_tools_are_open_to_members() {
        let (state, officer_headers, _, member_id) = fixture().await;
        let token = "c".repeat(64);
        sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
            .bind(hex::encode(Sha256::digest(token.as_bytes())))
            .bind(&member_id)
            .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
            .execute(&state.db)
            .await
            .unwrap();
        let mut member_headers = officer_headers.clone();
        member_headers.insert("cookie", format!("ph_session={token}").parse().unwrap());
        let seeds: serde_json::Value =
            serde_json::from_str(include_str!("../seeds/demo-fixtures.json")).unwrap();

        let officer_dashboard = portal_get(&state, &officer_headers, "product/dashboard").await;
        assert_eq!(
            officer_dashboard["heading"],
            seeds["member"]["/api/product/dashboard"]["body"]["heading"]
        );

        let officer_caps = portal_get(&state, &officer_headers, "capabilities").await;
        let member_caps = portal_get(&state, &member_headers, "capabilities").await;
        assert_eq!(officer_caps["portal"]["audience"], "officer");
        assert_eq!(member_caps["portal"]["audience"], "member");
        assert_eq!(member_caps["capabilities"], officer_caps["capabilities"]);
        let locks = member_caps["capabilities"].to_string();
        assert!(!locks.contains("development owner session"), "{locks}");
    }

    #[tokio::test]
    async fn portal_external_event_is_shared_but_officer_approval_is_guarded() {
        let (state, officer_headers, _, member_id) = fixture().await;
        let event = serde_json::json!({
            "title":"Sample Rust workshop", "organizer":"PyTorch PH", "summary":"A synthetic workshop used to verify portal writes.",
            "category":"workshops", "scope":"external", "startAt":"2026-10-01T09:00:00+08:00", "endAt":null,
            "timezone":"Asia/Manila", "venue":"Online", "registrationUrl":null, "registrationDeadline":null,
            "fee":"Free", "eligibility":[], "requirements":[], "sourceUrl":"https://example.test/event",
            "scrapedAt":"2026-09-29T00:00:00Z", "contentHash":format!("sha256:{}", "a".repeat(64)),
            "scraperVersion":"test", "confidence":1.0, "warnings":[]
        });
        let created = portal::gateway(
            State(state.clone()),
            Path("events".to_owned()),
            OriginalUri("/portal/api/events".parse().unwrap()),
            Method::POST,
            officer_headers.clone(),
            Bytes::from(event.to_string()),
        )
        .await
        .unwrap();
        assert_eq!(created.status(), StatusCode::CREATED);
        let body = axum::body::to_bytes(created.into_body(), 65536)
            .await
            .unwrap();
        let id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();

        let token = "c".repeat(64);
        sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
            .bind(hex::encode(Sha256::digest(token.as_bytes())))
            .bind(&member_id)
            .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
            .execute(&state.db)
            .await
            .unwrap();
        let mut member_headers = officer_headers;
        member_headers.insert("cookie", format!("ph_session={token}").parse().unwrap());
        let events = portal::gateway(
            State(state.clone()),
            Path("events".to_owned()),
            OriginalUri("/portal/api/events".parse().unwrap()),
            Method::GET,
            member_headers.clone(),
            Bytes::new(),
        )
        .await
        .unwrap();
        let body = axum::body::to_bytes(events.into_body(), 65536)
            .await
            .unwrap();
        let rows = serde_json::from_slice::<serde_json::Value>(&body).unwrap();
        assert!(rows.as_array().unwrap().iter().any(|item| item["id"] == id));
        let approval = portal::gateway(
            State(state),
            Path(format!("events/{id}")),
            OriginalUri(format!("/portal/api/events/{id}").parse().unwrap()),
            Method::PATCH,
            member_headers,
            Bytes::from(r#"{"action":"approve_department","department":"secretariat"}"#),
        )
        .await;
        assert!(matches!(approval, Err(ApiError(StatusCode::FORBIDDEN, _))));
    }

    #[tokio::test]
    async fn portal_photo_is_readable_only_by_its_owner() {
        use base64::Engine as _;
        let (state, officer_headers, _, member_id) = fixture().await;
        let mut jpeg = vec![0xff, 0xd8, 0xff];
        jpeg.extend([0u8; 96]);
        jpeg.extend([0xff, 0xd9]);
        let payload = serde_json::json!({"title":"Synthetic photo","photoData":format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&jpeg))});
        let created = portal::gateway(
            State(state.clone()),
            Path("product/evidence".to_owned()),
            OriginalUri("/portal/api/product/evidence".parse().unwrap()),
            Method::POST,
            officer_headers.clone(),
            Bytes::from(payload.to_string()),
        )
        .await
        .unwrap();
        assert_eq!(created.status(), StatusCode::CREATED);
        let body = axum::body::to_bytes(created.into_body(), 65536)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let media_id = value["item"]["mediaUrl"]
            .as_str()
            .unwrap()
            .split('/')
            .next_back()
            .unwrap()
            .to_owned();
        let owned = portal::media(
            State(state.clone()),
            Path(media_id.clone()),
            officer_headers.clone(),
        )
        .await
        .unwrap();
        assert_eq!(owned.status(), StatusCode::OK);

        let token = "d".repeat(64);
        sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
            .bind(hex::encode(Sha256::digest(token.as_bytes())))
            .bind(&member_id)
            .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
            .execute(&state.db)
            .await
            .unwrap();
        let mut other_headers = officer_headers;
        other_headers.insert("cookie", format!("ph_session={token}").parse().unwrap());
        let other = portal::media(State(state), Path(media_id), other_headers).await;
        assert!(matches!(other, Err(ApiError(StatusCode::NOT_FOUND, _))));
    }

    #[tokio::test]
    async fn authenticated_requests_extend_session_to_seventh_calendar_day() {
        let (state, headers, _, _) = fixture().await;
        let token = "a".repeat(64);
        let hash = hex::encode(Sha256::digest(token.as_bytes()));
        let app = Router::new()
            .route("/auth/me", get(auth::me))
            .layer(axum::middleware::from_fn_with_state(
                state.clone(),
                auth::refresh_session,
            ))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::new();
        let response = client
            .get(format!("http://{address}/auth/me"))
            .header("cookie", headers.get("cookie").unwrap())
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let cookie = response
            .headers()
            .get("set-cookie")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(cookie.contains("HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age="));
        assert!(cookie.contains("Expires="));
        let expiry: String =
            sqlx::query_scalar("SELECT expires_at FROM sessions WHERE token_hash = ?")
                .bind(&hash)
                .fetch_one(&state.db)
                .await
                .unwrap();
        let expected_date = (chrono::Utc::now().date_naive() + chrono::Days::new(7)).to_string();
        assert!(expiry.starts_with(&expected_date));
        assert!(expiry.contains("T23:59:59"));

        sqlx::query("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
            .bind((chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339())
            .bind(&hash)
            .execute(&state.db)
            .await
            .unwrap();
        let expired = client
            .get(format!("http://{address}/auth/me"))
            .header("cookie", headers.get("cookie").unwrap())
            .send()
            .await
            .unwrap();
        assert_eq!(expired.status(), StatusCode::UNAUTHORIZED);
        assert!(expired.headers().get("set-cookie").is_none());
        server.abort();
    }

    #[tokio::test]
    async fn demo_snapshot_is_seeded_once_and_served_from_sqlite() {
        let (state, _, _, _) = fixture().await;
        demo::seed(&state.db).await.unwrap();
        let Json(snapshot) = demo::fixtures(State(state.clone())).await.unwrap();
        assert_eq!(
            snapshot["member"]["/api/capabilities"]["body"]["portal"]["audience"],
            "member"
        );
        assert_eq!(
            snapshot["officer"]["/api/capabilities"]["body"]["portal"]["audience"],
            "officer"
        );

        sqlx::query("UPDATE demo_fixtures SET payload_json = ? WHERE id = 1")
            .bind(r#"{"member":{"/api/demo":{"status":200,"body":{"source":"database"}}},"officer":{}}"#)
            .execute(&state.db)
            .await
            .unwrap();
        demo::seed(&state.db).await.unwrap();
        let Json(updated) = demo::fixtures(State(state)).await.unwrap();
        assert_eq!(updated["member"]["/api/demo"]["body"]["source"], "database");
    }

    async fn fixture() -> (Arc<AppState>, HeaderMap, String, String) {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&db).await.unwrap();
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

    #[tokio::test]
    async fn signout_revokes_server_session_and_clears_cookie() {
        let (state, headers, _, _) = fixture().await;
        assert!(auth::viewer(&state, &headers).await.is_ok());
        let mut wrong_origin = headers.clone();
        wrong_origin.insert("origin", "https://elsewhere.example".parse().unwrap());
        assert!(matches!(
            auth::signout(State(state.clone()), wrong_origin).await,
            Err(ApiError(StatusCode::FORBIDDEN, _))
        ));
        assert!(auth::viewer(&state, &headers).await.is_ok());
        let response = auth::signout(State(state.clone()), headers.clone())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let cookie = response
            .headers()
            .get("set-cookie")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(cookie.starts_with("ph_session=;"));
        assert!(cookie.contains("Max-Age=0"));
        assert!(response.headers().get("cache-control").is_some());
        assert!(matches!(
            auth::viewer(&state, &headers).await,
            Err(ApiError(StatusCode::UNAUTHORIZED, _))
        ));
    }

    #[tokio::test]
    async fn email_signup_requires_the_current_code_and_creates_one_member() {
        let (state, headers, _, _) = fixture().await;
        let email = "new@example.test";
        let code = "12345678";
        sqlx::query("INSERT INTO pending_email_signups(email,display_name,public_handle,password_hash,code_hash,expires_at,sent_at) VALUES (?,?,?,?,?,?,?)")
            .bind(email).bind("New Member").bind("new_member")
            .bind(auth_email::password_hash("strong-password").unwrap())
            .bind(auth_email::code_hash(&state.email_code_secret, email, code))
            .bind((chrono::Utc::now() + chrono::Duration::minutes(10)).to_rfc3339())
            .bind(chrono::Utc::now().to_rfc3339()).execute(&state.db).await.unwrap();
        let wrong = auth_email::verify_signup(
            State(state.clone()),
            headers.clone(),
            Json(auth_email::SignupVerify {
                email: email.into(),
                code: "00000000".into(),
            }),
        )
        .await;
        assert!(matches!(wrong, Err(ApiError(StatusCode::BAD_REQUEST, _))));
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM members WHERE email=?")
            .bind(email)
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(count, 0);
        let response = auth_email::verify_signup(
            State(state.clone()),
            headers.clone(),
            Json(auth_email::SignupVerify {
                email: email.into(),
                code: code.into(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().get("set-cookie").is_some());
        let replay = auth_email::verify_signup(
            State(state.clone()),
            headers.clone(),
            Json(auth_email::SignupVerify {
                email: email.into(),
                code: code.into(),
            }),
        )
        .await;
        assert!(matches!(replay, Err(ApiError(StatusCode::BAD_REQUEST, _))));
        let logged_in = auth_email::password_login(
            State(state),
            headers,
            Json(auth_email::PasswordLogin {
                email: email.into(),
                password: "strong-password".into(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(logged_in.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn temporary_test_accounts_keep_member_and_officer_roles() {
        let (state, headers, _, _) = fixture().await;
        auth_email::seed_test_accounts(&state.db, "test-password")
            .await
            .unwrap();
        for (email, role) in [
            ("member@admin.ph", "member"),
            ("officer@admin.ph", "officer"),
        ] {
            let response = auth_email::password_login(
                State(state.clone()),
                headers.clone(),
                Json(auth_email::PasswordLogin {
                    email: email.into(),
                    password: "test-password".into(),
                }),
            )
            .await
            .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let actual: String = sqlx::query_scalar("SELECT role FROM members WHERE email=?")
                .bind(email)
                .fetch_one(&state.db)
                .await
                .unwrap();
            assert_eq!(actual, role);
        }
    }

    #[tokio::test]
    async fn officer_result_is_authoritative_and_corrections_reverse_points() {
        let (state, headers, _, member) = fixture().await;
        let (_, Json(created)) = events::create_event(
            State(state.clone()),
            headers.clone(),
            Json(events::NewEvent {
                title: "Community Hackathon".into(),
                category: "hackathon".into(),
                starts_at: (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339(),
                parent_id: None,
                entrant_kind: Some("individual".into()),
                place_points: Some(vec![50, 30]),
            }),
        )
        .await
        .unwrap();
        let event_id = created.id;
        let (_, Json(entrant)) = events::add_entrant(
            State(state.clone()),
            headers.clone(),
            Path(event_id.clone()),
            Json(events::NewEntrant {
                name: "Entrant 1".into(),
                member_ids: vec![member.clone()],
            }),
        )
        .await
        .unwrap();
        let first = events::publish_results(
            State(state.clone()),
            headers.clone(),
            Path(event_id.clone()),
            Json(events::ResultInput {
                expected_revision: 0,
                placements: vec![events::Placement {
                    place: 1,
                    entrant_id: entrant.id.clone(),
                }],
                reason: "Official judges result".into(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(first.0.revision, 1);
        let stale = events::publish_results(
            State(state.clone()),
            headers.clone(),
            Path(event_id.clone()),
            Json(events::ResultInput {
                expected_revision: 0,
                placements: vec![events::Placement {
                    place: 1,
                    entrant_id: entrant.id.clone(),
                }],
                reason: "Stale edit".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(stale.0, StatusCode::PRECONDITION_FAILED);
        let correction = events::publish_results(
            State(state.clone()),
            headers,
            Path(event_id.clone()),
            Json(events::ResultInput {
                expected_revision: 1,
                placements: vec![events::Placement {
                    place: 2,
                    entrant_id: entrant.id,
                }],
                reason: "Judges corrected place".into(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(correction.0.revision, 2);
        let ledger: Vec<(i64,)> =
            sqlx::query_as("SELECT delta FROM point_ledger WHERE event_id = ? ORDER BY rowid")
                .bind(&event_id)
                .fetch_all(&state.db)
                .await
                .unwrap();
        assert_eq!(
            ledger.into_iter().map(|row| row.0).collect::<Vec<_>>(),
            vec![50, -50, 30]
        );
        process_one_job(&state.db).await.unwrap();
        let points: i64 =
            sqlx::query_scalar("SELECT points FROM leaderboard_cache WHERE member_id = ?")
                .bind(member)
                .fetch_one(&state.db)
                .await
                .unwrap();
        assert_eq!(points, 30);
    }

    #[tokio::test]
    async fn unknown_member_and_unauthorized_user_cannot_enter_or_publish() {
        let (state, headers, _, _) = fixture().await;
        let (_, Json(created)) = events::create_event(
            State(state.clone()),
            headers.clone(),
            Json(events::NewEvent {
                title: "Workshop Challenge".into(),
                category: "workshop".into(),
                starts_at: (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339(),
                parent_id: None,
                entrant_kind: Some("team".into()),
                place_points: Some(vec![10]),
            }),
        )
        .await
        .unwrap();
        let invalid = events::add_entrant(
            State(state.clone()),
            headers.clone(),
            Path(created.id.clone()),
            Json(events::NewEntrant {
                name: "Invalid team".into(),
                member_ids: vec![Uuid::new_v4().to_string()],
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(invalid.0, StatusCode::UNPROCESSABLE_ENTITY);
        let mut no_cookie = HeaderMap::new();
        no_cookie.insert("origin", "https://pytorch.ph".parse().unwrap());
        let denied = events::publish_results(
            State(state),
            no_cookie,
            Path(created.id),
            Json(events::ResultInput {
                expected_revision: 0,
                placements: vec![],
                reason: "No access".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(denied.0, StatusCode::UNAUTHORIZED);
    }
}
