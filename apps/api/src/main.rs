mod accounts;
mod admission;
mod analytics;
mod attendance;
mod auth;
mod auth_email;
mod demo;
mod events;
mod evidence;
mod integrity;
mod leaderboard;
mod mail;
mod pdf;
mod portal;
mod reports;
mod sample;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, delete, get, post},
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

async fn health(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let mut body = admission::health_figures(&state.db).await;
    body["status"] = serde_json::json!("ok");
    Json(body)
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
    let admission_config = admission::Config::from_env();
    // Every running request and spool worker can hold a connection, plus one for the job worker.
    let connections = (admission_config.max_inflight + admission_config.spool_workers + 1).max(3);
    let db = SqlitePoolOptions::new()
        .max_connections(connections as u32)
        .connect_with(options)
        .await?;
    sqlx::migrate!().run(&db).await?;
    let recovered = admission::recover(&db).await.map_err(|error| error.1)?;
    info!(recovered, config = ?admission_config, "admission.configured");
    demo::seed(&db).await?;
    if env::var("SEED_TEMP_TEST_ACCOUNTS").ok().as_deref() == Some("true") {
        let password = env::var("TEMP_TEST_PASSWORD")?;
        auth_email::seed_test_accounts(&db, &password).await?;
    }
    if env::var("SEED_SAMPLE_DATA").ok().as_deref() == Some("true") {
        sample::seed(&db).await?;
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
    let gate = admission::Admission::new(admission_config, state.clone());
    let cors = CorsLayer::new()
        .allow_origin(allowed_origin.parse::<HeaderValue>()?)
        .allow_credentials(true)
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::IF_MATCH,
        ])
        // The browser must see x-queued to follow a spooled request.
        .expose_headers([axum::http::HeaderName::from_static("x-queued")])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ]);
    let app = Router::new()
        .route("/health", get(health))
        .route("/queue/{id}", get(admission::queue_status))
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
        .route("/members/me", delete(auth::delete_account))
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
        .layer(axum::middleware::from_fn_with_state(
            gate.clone(),
            admission::admit,
        ))
        .layer(RequestBodyLimitLayer::new(384 * 1024))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);
    let bind = env::var("APP_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_owned());
    let address: SocketAddr = bind.parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    for _ in 0..gate.config.spool_workers {
        tokio::spawn(admission::spool_worker(gate.clone(), app.clone()));
    }
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

    #[tokio::test]
    async fn cascade_migration_keeps_data_and_member_deletion_removes_only_their_rows() {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let mut before = sqlx::migrate!();
        before.migrations = std::borrow::Cow::Owned(
            before
                .migrations
                .iter()
                .filter(|m| m.version < 5)
                .cloned()
                .collect(),
        );
        before.run(&db).await.unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        for (id, role) in [("off", "officer"), ("mem", "member"), ("oth", "member")] {
            sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,?,?)")
                .bind(id).bind(id).bind(format!("{id}@example.test")).bind(id).bind(id).bind(role).bind(&now)
                .execute(&db).await.unwrap();
        }
        for sql in [
            "INSERT INTO sessions VALUES ('t-mem','mem','2099-01-01')",
            "INSERT INTO events(id,title,category,starts_at,competitive,entrant_kind,last_place,created_by,created_at) VALUES ('ev','Hack','hackathon','2026-01-01',1,'individual',3,'off','2026-01-01')",
            "INSERT INTO place_points VALUES ('ev',1,50)",
            "INSERT INTO entrants VALUES ('en-mem','ev','Mem','individual')",
            "INSERT INTO entrants VALUES ('en-oth','ev','Oth','individual')",
            "INSERT INTO entrant_members VALUES ('en-mem','ev','mem')",
            "INSERT INTO entrant_members VALUES ('en-oth','ev','oth')",
            "INSERT INTO results VALUES ('ev',1,'en-mem',1)",
            "INSERT INTO point_ledger(id,member_id,event_id,entrant_id,place,delta,result_revision,actor_id,reason,created_at) VALUES ('pl-mem','mem','ev','en-mem',1,50,1,'off','result','2026-01-01')",
            "INSERT INTO point_ledger(id,member_id,source_type,source_id,delta,actor_id,reason,created_at) VALUES ('pl-oth','oth','attendance','ev',5,'off','attended','2026-01-01')",
            "INSERT INTO evidence_claims(id,member_id,kind,title,source_url,content_hash,status,reviewed_by,created_at) VALUES ('ec','mem','personal_project','P','https://x.test','h','approved','off','2026-01-01')",
            "INSERT INTO audit_events VALUES ('au-mem','mem','op','ev',NULL,'2026-01-01')",
            "INSERT INTO audit_events VALUES ('au-off','off','op','ev',NULL,'2026-01-01')",
            "INSERT INTO leaderboard_cache VALUES ('mem',50,'2026-01-01')",
            "INSERT INTO attendance_sources VALUES ('ev','form',5,'off','2026-01-01',NULL)",
            "INSERT INTO attendance_responses VALUES ('form','r1','ev','2026-01-01','oth@example.test','oth','awarded','off','2026-01-01')",
            "INSERT INTO officer_roles VALUES ('off','executive')",
            "INSERT INTO mail_routes VALUES ('general','[]','executive','off','2026-01-01')",
            "INSERT INTO mail_drafts VALUES ('md','general','off',1,'draft','2026-01-01','2026-01-01')",
            "INSERT INTO mail_revisions(draft_id,revision,recipients_json,subject,body,content_hash,required_roles_json,sender_role,edited_by,created_at) VALUES ('md',1,'[]','S','B','h','[]','executive','off','2026-01-01')",
            "INSERT INTO mail_approvals VALUES ('md',1,'executive','off','2026-01-01')",
            "INSERT INTO portal_state VALUES ('mem','/api/member/privacy','{}','2026-01-01')",
            "INSERT INTO portal_state VALUES ('__organization__','/api/feedback','[]','2026-01-01')",
        ] {
            sqlx::query(sql).execute(&db).await.unwrap();
        }
        let counts_before = table_counts(&db).await;

        sqlx::migrate!().run(&db).await.unwrap();
        let counts_after: Vec<(String, i64)> = table_counts(&db)
            .await
            .into_iter()
            .filter(|(name, _)| counts_before.iter().any(|(before, _)| before == name))
            .collect();
        assert_eq!(counts_after, counts_before, "rebuild must keep every row");
        assert_eq!(
            count(&db, "SELECT COUNT(*) FROM pragma_foreign_key_check").await,
            0
        );
        assert_eq!(
            count(&db, "SELECT foreign_keys FROM pragma_foreign_keys").await,
            1
        );

        // A departing officer takes their own rows, never other members' data.
        sqlx::query("DELETE FROM members WHERE id='off'")
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(
            count(
                &db,
                "SELECT COUNT(*) FROM events WHERE id='ev' AND created_by IS NULL"
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &db,
                "SELECT COUNT(*) FROM point_ledger WHERE actor_id IS NULL"
            )
            .await,
            2
        );
        assert_eq!(
            count(
                &db,
                "SELECT COUNT(*) FROM evidence_claims WHERE reviewed_by IS NULL"
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &db,
                "SELECT COUNT(*) FROM attendance_responses WHERE imported_by IS NULL"
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &db,
                "SELECT COUNT(*) FROM mail_drafts WHERE created_by IS NULL"
            )
            .await,
            1
        );
        assert_eq!(count(&db, "SELECT COUNT(*) FROM officer_roles").await, 0);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM mail_approvals").await, 0);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM audit_events").await, 1);

        // A departing member leaves no row behind that points at them.
        sqlx::query("DELETE FROM members WHERE id='mem'")
            .execute(&db)
            .await
            .unwrap();
        for sql in [
            "SELECT COUNT(*) FROM sessions WHERE member_id='mem'",
            "SELECT COUNT(*) FROM entrant_members WHERE member_id='mem'",
            "SELECT COUNT(*) FROM point_ledger WHERE member_id='mem'",
            "SELECT COUNT(*) FROM evidence_claims",
            "SELECT COUNT(*) FROM audit_events",
            "SELECT COUNT(*) FROM leaderboard_cache",
            "SELECT COUNT(*) FROM portal_state WHERE scope='mem'",
        ] {
            assert_eq!(count(&db, sql).await, 0, "{sql}");
        }
        assert_eq!(
            count(
                &db,
                "SELECT COUNT(*) FROM point_ledger WHERE member_id='oth'"
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &db,
                "SELECT COUNT(*) FROM entrant_members WHERE member_id='oth'"
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &db,
                "SELECT COUNT(*) FROM portal_state WHERE scope='__organization__'"
            )
            .await,
            1
        );

        // Deleting an event removes everything that belongs to it.
        sqlx::query("DELETE FROM events WHERE id='ev'")
            .execute(&db)
            .await
            .unwrap();
        for table in [
            "place_points",
            "entrants",
            "entrant_members",
            "results",
            "attendance_sources",
            "attendance_responses",
        ] {
            assert_eq!(
                count(&db, &format!("SELECT COUNT(*) FROM {table}")).await,
                0,
                "{table}"
            );
        }
        assert_eq!(
            count(
                &db,
                "SELECT COUNT(*) FROM point_ledger WHERE event_id IS NOT NULL"
            )
            .await,
            0
        );
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

    async fn claim(state: &Arc<AppState>, id: &str, member: &str, origin: &str) {
        sqlx::query("INSERT INTO evidence_claims(id,member_id,kind,title,source_url,origin,content_hash,status,created_at) VALUES (?,?,'external_talk','Talk','https://example.test/talk',?,?,'pending',?)")
            .bind(id).bind(member).bind(origin).bind(format!("hash-{id}")).bind(chrono::Utc::now().to_rfc3339())
            .execute(&state.db).await.unwrap();
    }

    #[tokio::test]
    async fn officer_review_feeds_leaderboard_and_sanction_appeal_restores_eligibility() {
        let (state, officer, officer_id, member_id) = fixture().await;
        let token = "e".repeat(64);
        sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
            .bind(hex::encode(Sha256::digest(token.as_bytes())))
            .bind(&member_id)
            .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
            .execute(&state.db)
            .await
            .unwrap();
        let mut member = officer.clone();
        member.insert("cookie", format!("ph_session={token}").parse().unwrap());
        let now = chrono::Utc::now();
        sqlx::query("INSERT INTO leaderboard_seasons VALUES ('test-now','Test season',?,?)")
            .bind((now - chrono::Duration::days(1)).to_rfc3339())
            .bind((now + chrono::Duration::days(1)).to_rfc3339())
            .execute(&state.db)
            .await
            .unwrap();
        claim(&state, "c-ok", &member_id, "manual").await;
        claim(&state, "c-fake", &member_id, "manual").await;
        claim(&state, "c-own", &officer_id, "manual").await;

        let (status, queue) = portal_call(
            &state,
            &officer,
            Method::GET,
            "/portal/api/officer/evidence",
            serde_json::json!(null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            queue
                .as_array()
                .unwrap()
                .iter()
                .all(|c| c["provenance"] == "manual_pending")
        );

        let (status, _) = portal_call(
            &state,
            &officer,
            Method::PATCH,
            "/portal/api/officer/evidence/c-own",
            serde_json::json!({"decision":"approve","level":"winner_top_award","reason":""}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "no self-review");
        let (status, _) = portal_call(
            &state,
            &member,
            Method::PATCH,
            "/portal/api/officer/evidence/c-ok",
            serde_json::json!({"decision":"approve","level":"contributor","reason":""}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "members cannot review");
        let (status, approved) = portal_call(
            &state,
            &officer,
            Method::PATCH,
            "/portal/api/officer/evidence/c-ok",
            serde_json::json!({"decision":"approve","level":"contributor","reason":""}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(approved["provenance"], "officer_reviewed");
        assert_eq!(
            approved["points"], 60,
            "contributor = 2 units x 10 x manual weight 3"
        );
        assert_eq!(approved["proposedLevel"], "contributor");

        let (_, board) = portal_call(
            &state,
            &member,
            Method::GET,
            "/portal/api/member/leaderboard?page=1&pageSize=25&view=both",
            serde_json::json!(null),
        )
        .await;
        let me = board["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["isCurrentUser"] == true)
            .unwrap()
            .clone();
        assert_eq!(me["verifiedPoints"], 60);
        assert_eq!(
            me["pendingPoints"], 30,
            "one pending manual claim at participation"
        );
        assert_eq!(board["season"]["state"], "active");
        let (_, overview) = portal_call(
            &state,
            &member,
            Method::GET,
            "/portal/api/member/overview",
            serde_json::json!(null),
        )
        .await;
        assert_eq!(overview["summary"]["points"], 60);
        assert_eq!(overview["summary"]["verifiedEvidence"], 1);

        let (status, _) = portal_call(&state, &officer, Method::PATCH, "/portal/api/officer/evidence/c-fake",
            serde_json::json!({"decision":"confirm_falsification","reason":"Certificate was edited"})).await;
        assert_eq!(status, StatusCode::OK);
        let (_, cases) = portal_call(
            &state,
            &member,
            Method::GET,
            "/portal/api/evidence/integrity",
            serde_json::json!(null),
        )
        .await;
        let sanction_id = cases[0]["sanctionId"].as_str().unwrap().to_owned();
        assert_eq!(cases[0]["reason"], "Certificate was edited");
        let (_, board) = portal_call(
            &state,
            &member,
            Method::GET,
            "/portal/api/member/leaderboard",
            serde_json::json!(null),
        )
        .await;
        assert!(
            board["entries"]
                .as_array()
                .unwrap()
                .iter()
                .all(|e| e["isCurrentUser"] == false),
            "sanctioned member is not ranked"
        );

        let (status, _) = portal_call(&state, &member, Method::POST, "/portal/api/evidence/integrity",
            serde_json::json!({"sanctionId": sanction_id, "note": "I can share the original file."})).await;
        assert_eq!(status, StatusCode::CREATED);
        let (status, _) = portal_call(&state, &member, Method::POST, "/portal/api/evidence/integrity",
            serde_json::json!({"sanctionId": sanction_id, "note": "Second appeal while one is open."})).await;
        assert_eq!(status, StatusCode::CONFLICT);
        let (_, appeals) = portal_call(
            &state,
            &officer,
            Method::GET,
            "/portal/api/officer/evidence/appeals",
            serde_json::json!(null),
        )
        .await;
        assert_eq!(appeals[0]["violationType"], "manual_falsification");
        let appeal_id = appeals[0]["id"].as_str().unwrap().to_owned();
        let (status, _) = portal_call(
            &state,
            &officer,
            Method::PATCH,
            &format!("/portal/api/officer/evidence/appeals/{appeal_id}"),
            serde_json::json!({"decision":"restore","reason":"Original file verified"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (_, cases) = portal_call(
            &state,
            &member,
            Method::GET,
            "/portal/api/evidence/integrity",
            serde_json::json!(null),
        )
        .await;
        assert_eq!(cases, serde_json::json!([]));
        let (_, board) = portal_call(
            &state,
            &member,
            Method::GET,
            "/portal/api/member/leaderboard",
            serde_json::json!(null),
        )
        .await;
        assert!(
            board["entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["isCurrentUser"] == true)
        );

        sqlx::query("DELETE FROM members WHERE id = ?")
            .bind(&member_id)
            .execute(&state.db)
            .await
            .unwrap();
        for table in [
            "evidence_claims WHERE member_id != '' AND id != 'c-own'",
            "evidence_claim_reviews",
            "leaderboard_sanctions",
            "evidence_appeals",
        ] {
            assert_eq!(
                count(&state.db, &format!("SELECT COUNT(*) FROM {table}")).await,
                0,
                "{table}"
            );
        }
    }

    #[tokio::test]
    async fn sample_data_is_idempotent_ranked_and_removed_by_one_delete() {
        let (state, officer, _, _) = fixture().await;
        sample::seed(&state.db).await.unwrap();
        sample::seed(&state.db).await.unwrap();
        assert_eq!(
            count(
                &state.db,
                "SELECT COUNT(*) FROM members WHERE is_sample = 1"
            )
            .await,
            8
        );
        assert_eq!(
            count(&state.db, "SELECT COUNT(*) FROM point_ledger").await,
            36
        );
        let (_, board) = portal_call(
            &state,
            &officer,
            Method::GET,
            "/portal/api/member/leaderboard?season=",
            serde_json::json!(null),
        )
        .await;
        assert_eq!(board["entries"][0]["displayLabel"], "Ari_Sample");

        sqlx::query("DELETE FROM members WHERE is_sample = 1")
            .execute(&state.db)
            .await
            .unwrap();
        for table in ["point_ledger", "member_skills", "evidence_claims"] {
            assert_eq!(
                count(&state.db, &format!("SELECT COUNT(*) FROM {table}")).await,
                0,
                "{table}"
            );
        }
        assert_eq!(count(&state.db, "SELECT COUNT(*) FROM members").await, 2);
    }

    #[tokio::test]
    async fn approved_manual_evidence_enters_the_officer_review_queue() {
        let (state, officer, _, member_id) = fixture().await;
        let token = "f".repeat(64);
        sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
            .bind(hex::encode(Sha256::digest(token.as_bytes())))
            .bind(&member_id)
            .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
            .execute(&state.db)
            .await
            .unwrap();
        let mut member = officer.clone();
        member.insert("cookie", format!("ph_session={token}").parse().unwrap());
        let item = |title: &str| serde_json::json!({"item": {"title": title, "sourceUrl": "https://github.com/example/repo", "description": "Built a classifier"}, "approve": true});

        let (status, draft) = portal_call(
            &state,
            &member,
            Method::POST,
            "/portal/api/product/evidence",
            serde_json::json!({"item": {"title": "Draft only"}}),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{draft}");
        assert_eq!(
            count(&state.db, "SELECT COUNT(*) FROM evidence_claims").await,
            0,
            "drafts stay private"
        );

        let (_, created) = portal_call(
            &state,
            &member,
            Method::POST,
            "/portal/api/product/evidence",
            item("Image classifier"),
        )
        .await;
        let id = created["item"]["id"].as_str().unwrap().to_owned();
        let (_, queue) = portal_call(
            &state,
            &officer,
            Method::GET,
            "/portal/api/officer/evidence",
            serde_json::json!(null),
        )
        .await;
        assert_eq!(queue[0]["id"], id.as_str());
        assert_eq!(queue[0]["provenance"], "manual_pending");

        portal_call(
            &state,
            &member,
            Method::PATCH,
            &format!("/portal/api/product/evidence/{id}"),
            item("Image classifier v2"),
        )
        .await;
        assert_eq!(
            count(
                &state.db,
                "SELECT COUNT(*) FROM evidence_claims WHERE title='Image classifier v2'"
            )
            .await,
            1
        );

        let (status, _) = portal_call(
            &state,
            &officer,
            Method::PATCH,
            &format!("/portal/api/officer/evidence/{id}"),
            serde_json::json!({"decision":"approve","level":"participation","reason":""}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        portal_call(
            &state,
            &member,
            Method::PATCH,
            &format!("/portal/api/product/evidence/{id}"),
            item("Edited after review"),
        )
        .await;
        assert_eq!(count(&state.db, "SELECT COUNT(*) FROM evidence_claims WHERE title='Image classifier v2' AND status='approved'").await, 1, "reviewed claims are final");
    }

    #[tokio::test]
    async fn leaderboard_achievements_are_private_until_the_member_opts_in() {
        let (state, officer, _, member_id) = fixture().await;
        let token = "9".repeat(64);
        sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
            .bind(hex::encode(Sha256::digest(token.as_bytes())))
            .bind(&member_id)
            .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
            .execute(&state.db)
            .await
            .unwrap();
        let mut member = officer.clone();
        member.insert("cookie", format!("ph_session={token}").parse().unwrap());
        claim(&state, "c-shown", &member_id, "manual").await;
        portal_call(
            &state,
            &officer,
            Method::PATCH,
            "/portal/api/officer/evidence/c-shown",
            serde_json::json!({"decision":"approve","level":"contributor","reason":""}),
        )
        .await;
        let profile = format!("/portal/api/member/leaderboard/profile?id={member_id}");

        let (status, _) = portal_call(
            &state,
            &officer,
            Method::GET,
            &profile,
            serde_json::json!(null),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "implicit deny");
        let (_, board) = portal_call(
            &state,
            &officer,
            Method::GET,
            "/portal/api/member/leaderboard",
            serde_json::json!(null),
        )
        .await;
        let row = board["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["verifiedPoints"] == 60)
            .unwrap()
            .clone();
        assert!(row["profileId"].is_null(), "private rows are not linkable");
        let (status, own) = portal_call(
            &state,
            &member,
            Method::GET,
            &profile,
            serde_json::json!(null),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "members always see their own");
        assert_eq!(own["evidence"][0]["level"], "contributor");

        let settings = serde_json::json!({"hideGoogleIdentity":true,"hideRealName":true,"deviceCacheEnabled":false,"anonymousRanking":true,"automaticErrorReports":false,"shareAchievements":true});
        let (status, _) = portal_call(
            &state,
            &member,
            Method::PUT,
            "/portal/api/member/privacy",
            settings,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (status, shared) = portal_call(
            &state,
            &officer,
            Method::GET,
            &profile,
            serde_json::json!(null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(shared["evidence"][0]["title"], "Talk");
        assert!(
            shared["evidence"][0]["sourceUrl"].is_null(),
            "anonymous members keep source links hidden"
        );
        assert!(
            shared["standing"]["displayLabel"]
                .as_str()
                .unwrap()
                .starts_with("Member ")
        );
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

    #[tokio::test]
    async fn report_attachments_are_bounded_and_visible_to_reporter_and_officers() {
        let (state, officer, _, member_id) = fixture().await;
        let member = member_session(&state, &officer, &member_id, &"1".repeat(64)).await;
        let (status, created) = portal_call(&state, &member, Method::POST, "/portal/api/feedback", serde_json::json!({
            "category": "bug", "description": "Button does nothing", "route": "/career/evidence",
            "uiState": {"title": "Career Evidence", "online": true, "viewport": "1280x720", "componentMarkers": []}
        })).await;
        assert_eq!(status, StatusCode::CREATED, "{created}");
        let id = created["id"].as_str().unwrap().to_owned();
        let attach = format!("/portal/api/feedback/{id}/attachments");
        for (kind, data) in [
            (
                "logs",
                serde_json::json!([{"level": "error", "message": "TypeError: x is undefined", "at": "2026-09-29T00:00:00Z"}]),
            ),
            (
                "page_state",
                serde_json::json!("<main><h1>Career Evidence</h1></main>"),
            ),
            (
                "screenshot",
                serde_json::json!("data:image/jpeg;base64,/9j/4AAQSkZJRg=="),
            ),
        ] {
            let (status, body) = portal_call(
                &state,
                &member,
                Method::POST,
                &attach,
                serde_json::json!({"kind": kind, "data": data}),
            )
            .await;
            assert_eq!(status, StatusCode::CREATED, "{kind}: {body}");
        }
        let (status, _) = portal_call(&state, &member, Method::POST, &attach,
            serde_json::json!({"kind": "logs", "data": [{"level": "error", "message": "x", "at": "t", "extra": 1}]})).await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "log entries are strict"
        );
        let (status, _) = portal_call(
            &state,
            &officer,
            Method::POST,
            &attach,
            serde_json::json!({"kind": "logs", "data": []}),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "only the reporter attaches");

        let (_, list) = portal_call(
            &state,
            &officer,
            Method::GET,
            "/portal/api/feedback?paginated=1",
            serde_json::json!(null),
        )
        .await;
        assert_eq!(
            list["items"][0]["attachments"],
            serde_json::json!(["logs", "page_state", "screenshot"])
        );
        let (status, items) = portal_call(
            &state,
            &officer,
            Method::GET,
            &attach,
            serde_json::json!(null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            items[0]["content"][0]["message"],
            "TypeError: x is undefined"
        );
        assert!(
            items[2]["content"]
                .as_str()
                .unwrap()
                .starts_with("data:image/jpeg;base64,")
        );

        let other = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,'member',?)")
            .bind(&other).bind(&other).bind("other@example.test").bind("Other").bind("Other-1").bind(chrono::Utc::now().to_rfc3339())
            .execute(&state.db).await.unwrap();
        let outsider = member_session(&state, &officer, &other, &"2".repeat(64)).await;
        let (status, _) = portal_call(
            &state,
            &outsider,
            Method::GET,
            &attach,
            serde_json::json!(null),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        sqlx::query("DELETE FROM members WHERE id = ?")
            .bind(&member_id)
            .execute(&state.db)
            .await
            .unwrap();
        assert_eq!(
            count(&state.db, "SELECT COUNT(*) FROM feedback_attachments").await,
            0
        );
    }

    #[tokio::test]
    async fn verified_accounts_are_canonical_unique_and_cascade() {
        let (state, officer, _, member_id) = fixture().await;
        let member = member_session(&state, &officer, &member_id, &"3".repeat(64)).await;
        let (status, _) = portal_call(
            &state,
            &member,
            Method::PUT,
            "/portal/api/member/accounts/github",
            serde_json::json!({"handle": "Octo", "profileUrl": "https://github.com/someone-else"}),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "URL must match the handle"
        );
        let (status, saved) = portal_call(
            &state,
            &member,
            Method::PUT,
            "/portal/api/member/accounts/github",
            serde_json::json!({"handle": "Octo", "profileUrl": "https://github.com/octo"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{saved}");
        assert_eq!(saved["profileUrl"], "https://github.com/octo");
        let (status, _) = portal_call(
            &state,
            &officer,
            Method::PUT,
            "/portal/api/member/accounts/github",
            serde_json::json!({"handle": "octo", "profileUrl": "https://github.com/octo"}),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::CONFLICT,
            "one member per external account"
        );
        let (_, list) = portal_call(
            &state,
            &member,
            Method::GET,
            "/portal/api/member/accounts",
            serde_json::json!(null),
        )
        .await;
        assert_eq!(list.as_array().unwrap().len(), 1);
        let (status, _) = portal_call(&state, &member, Method::PUT, "/portal/api/member/accounts/facebook",
            serde_json::json!({"handle": "id:12345", "profileUrl": "https://www.facebook.com/profile.php?id=12345"})).await;
        assert_eq!(status, StatusCode::OK);
        let (status, _) = portal_call(
            &state,
            &member,
            Method::DELETE,
            "/portal/api/member/accounts/facebook",
            serde_json::Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        sqlx::query("DELETE FROM members WHERE id = ?")
            .bind(&member_id)
            .execute(&state.db)
            .await
            .unwrap();
        assert_eq!(
            count(&state.db, "SELECT COUNT(*) FROM member_accounts").await,
            0
        );
    }

    #[tokio::test]
    async fn officer_dashboard_analytics_are_live_and_members_keep_the_template() {
        let (state, officer, _, member_id) = fixture().await;
        let member = member_session(&state, &officer, &member_id, &"4".repeat(64)).await;
        sqlx::query("INSERT INTO evidence_claims(id,member_id,kind,title,source_url,content_hash,status,created_at) VALUES ('c-load',?,'external_competition','Contest','https://example.test/contest','hash-load','pending',?)")
            .bind(&member_id)
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(&state.db)
            .await
            .unwrap();
        let (status, dashboard) = portal_call(
            &state,
            &officer,
            Method::GET,
            "/portal/api/product/dashboard",
            serde_json::json!(null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let analytics = &dashboard["analytics"];
        assert_eq!(analytics["metrics"]["state"], "live");
        assert_eq!(
            analytics["metrics"]["data"][0]["value"], "2",
            "two approved members"
        );
        assert_eq!(
            analytics["metrics"]["data"][1]["value"], "2",
            "both have unexpired sessions or new evidence"
        );
        assert_eq!(analytics["activity"]["data"].as_array().unwrap().len(), 7);
        let relations = analytics["departments"]["data"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["department"] == "External relations")
            .unwrap()
            .clone();
        assert_eq!(
            relations["open"], 1,
            "competition evidence waits for external relations"
        );

        let (_, own) = portal_call(
            &state,
            &member,
            Method::GET,
            "/portal/api/product/dashboard",
            serde_json::json!(null),
        )
        .await;
        assert_ne!(
            own["analytics"]["metrics"]["state"], "live",
            "members do not get organization analytics"
        );
    }

    #[tokio::test]
    async fn gate_serves_waiters_by_priority_then_arrival() {
        let gate = admission::Gate::new(1, 10);
        let admission::Admit::Now(first) = gate.enter(3, true) else {
            panic!("slot free")
        };
        let admission::Admit::Wait(mut heavy) = gate.enter(4, true) else {
            panic!("queued")
        };
        let admission::Admit::Wait(mut read) = gate.enter(2, true) else {
            panic!("queued")
        };
        let admission::Admit::Wait(mut login) = gate.enter(1, false) else {
            panic!("queued")
        };
        drop(first);
        let second = login.try_recv().expect("auth goes first");
        assert!(read.try_recv().is_err() && heavy.try_recv().is_err());
        drop(second);
        let third = read.try_recv().expect("then reads");
        drop(third);
        let fourth = heavy.try_recv().expect("heavy work last");
        drop(fourth);
        assert_eq!(gate.load(), (0, 0));
    }

    async fn echo(State(state): State<Arc<AppState>>, headers: HeaderMap, body: Bytes) -> String {
        let who = auth::viewer(&state, &headers)
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

    #[tokio::test]
    async fn full_ram_queue_spills_to_disk_and_replays_as_the_same_member() {
        let (state, officer, officer_id, member_id) = fixture().await;
        let (gate, app) = admission_app(&state, tight(1 << 20));
        let admission::Admit::Now(busy) = gate.gate.enter(2, false) else {
            panic!("slot free")
        };

        let (status, headers, body, _) = send(&app, Method::POST, "/echo", &officer, "hello").await;
        assert_eq!(status, StatusCode::ACCEPTED);
        assert_eq!(headers["x-queued"], "1");
        let job = body["jobId"].as_str().unwrap().to_owned();
        let (status, _, waiting, _) =
            send(&app, Method::GET, &format!("/queue/{job}"), &officer, "").await;
        assert_eq!(
            (status, waiting["status"].as_str()),
            (StatusCode::ACCEPTED, Some("queued"))
        );

        drop(busy);
        assert!(admission::run_next(&gate, &app).await.unwrap());
        let (status, _, done, _) =
            send(&app, Method::GET, &format!("/queue/{job}"), &officer, "").await;
        assert_eq!(
            (status, done["status"].as_str()),
            (StatusCode::OK, Some("done"))
        );
        let stored = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            done["response"]["body"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(
            String::from_utf8(stored).unwrap(),
            format!("{officer_id}:hello")
        );
        assert_eq!(
            count(
                &state.db,
                "SELECT COUNT(*) FROM request_spool WHERE body IS NOT NULL"
            )
            .await,
            0,
            "request bodies are dropped after replay"
        );

        let other = member_session(&state, &officer, &member_id, &"5".repeat(64)).await;
        let (status, _, _, _) = send(&app, Method::GET, &format!("/queue/{job}"), &other, "").await;
        assert_eq!(
            status,
            StatusCode::NOT_FOUND,
            "only the owner reads a spooled result"
        );
    }

    #[tokio::test]
    async fn auth_never_spills_and_a_full_disk_budget_is_the_only_rejection() {
        let (state, officer, _, _) = fixture().await;
        let (gate, app) = admission_app(&state, tight(0));
        let admission::Admit::Now(busy) = gate.gate.enter(2, false) else {
            panic!("slot free")
        };
        let (status, headers, _, _) = send(&app, Method::POST, "/echo", &officer, "x").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(headers[axum::http::header::RETRY_AFTER], "30");

        let login = tokio::spawn({
            let app = app.clone();
            let officer = officer.clone();
            async move {
                send(&app, Method::POST, "/auth/echo", &officer, "x")
                    .await
                    .0
            }
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(
            gate.gate.load().1,
            1,
            "auth waits in RAM instead of spilling"
        );
        drop(busy);
        assert_eq!(login.await.unwrap(), StatusCode::OK);
    }

    #[tokio::test]
    async fn interrupted_spool_work_is_recovered_after_restart() {
        let (state, _, _, _) = fixture().await;
        sqlx::query("INSERT INTO request_spool(id,priority,method,path,status,created_at,expires_at) VALUES ('r1',2,'GET','/health','running','2026-01-01T00:00:00Z','2099-01-01T00:00:00Z')")
            .execute(&state.db).await.unwrap();
        assert_eq!(admission::recover(&state.db).await.unwrap(), 1);
        assert_eq!(
            count(
                &state.db,
                "SELECT COUNT(*) FROM request_spool WHERE status='queued'"
            )
            .await,
            1
        );
        sqlx::query("UPDATE request_spool SET status='done', expires_at='2000-01-01T00:00:00Z'")
            .execute(&state.db)
            .await
            .unwrap();
        assert_eq!(admission::cleanup(&state.db).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn member_can_delete_their_own_account_with_confirmation() {
        let (state, officer_headers, _, member_id) = fixture().await;
        let token = "d".repeat(64);
        sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
            .bind(hex::encode(Sha256::digest(token.as_bytes())))
            .bind(&member_id)
            .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
            .execute(&state.db)
            .await
            .unwrap();
        let mut member_headers = officer_headers.clone();
        member_headers.insert("cookie", format!("ph_session={token}").parse().unwrap());

        let unconfirmed = auth::delete_account(
            State(state.clone()),
            member_headers.clone(),
            Json(serde_json::from_value(serde_json::json!({"confirm": "yes"})).unwrap()),
        )
        .await;
        assert!(matches!(
            unconfirmed,
            Err(ApiError(StatusCode::BAD_REQUEST, _))
        ));

        let mut foreign = member_headers.clone();
        foreign.insert("origin", "https://evil.test".parse().unwrap());
        let cross_site = auth::delete_account(
            State(state.clone()),
            foreign,
            Json(serde_json::from_value(serde_json::json!({"confirm": "DELETE"})).unwrap()),
        )
        .await;
        assert!(matches!(
            cross_site,
            Err(ApiError(StatusCode::FORBIDDEN, _))
        ));

        let deleted = auth::delete_account(
            State(state.clone()),
            member_headers.clone(),
            Json(serde_json::from_value(serde_json::json!({"confirm": "DELETE"})).unwrap()),
        )
        .await
        .unwrap();
        assert_eq!(deleted.status(), StatusCode::OK);
        assert!(
            deleted.headers()["set-cookie"]
                .to_str()
                .unwrap()
                .contains("Max-Age=0")
        );
        assert_eq!(
            count(
                &state.db,
                &format!("SELECT COUNT(*) FROM members WHERE id='{member_id}'")
            )
            .await,
            0
        );
        assert_eq!(
            count(
                &state.db,
                &format!("SELECT COUNT(*) FROM sessions WHERE member_id='{member_id}'")
            )
            .await,
            0
        );
        assert!(auth::viewer(&state, &member_headers).await.is_err());
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
