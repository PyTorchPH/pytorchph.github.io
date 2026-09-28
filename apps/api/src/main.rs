mod attendance;
mod auth;
mod events;
mod evidence;
mod mail;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
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
    http: reqwest::Client,
    google_keys: tokio::sync::Mutex<Option<(std::time::Instant, jsonwebtoken::jwk::JwkSet)>>,
    workflow_key: Option<String>,
    live_email_enabled: bool,
    google_forms_client_id: Option<String>,
    google_forms_client_secret: Option<String>,
    google_forms_refresh_token: Option<String>,
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
    let body: Vec<_> = rows.into_iter().enumerate().map(|(i, (member_id, display_name, points))| {
        serde_json::json!({"rank": i + 1, "memberId": member_id, "displayName": display_name, "points": points})
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
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .build()?,
        google_keys: tokio::sync::Mutex::new(None),
        workflow_key: env::var("N8N_SHARED_KEY").ok(),
        live_email_enabled: env::var("ENABLE_LIVE_EMAIL").ok().as_deref() == Some("true"),
        google_forms_client_id: env::var("GOOGLE_FORMS_CLIENT_ID").ok(),
        google_forms_client_secret: env::var("GOOGLE_FORMS_CLIENT_SECRET").ok(),
        google_forms_refresh_token: env::var("GOOGLE_FORMS_REFRESH_TOKEN").ok(),
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
        .route("/auth/google", post(auth::google_login))
        .route("/auth/me", get(auth::me))
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
        .route("/internal/mail/claim", post(mail::claim_dispatch))
        .route("/internal/mail/{id}/receipt", post(mail::record_receipt))
        .layer(RequestBodyLimitLayer::new(64 * 1024))
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
    use axum::extract::Path;
    use sha2::{Digest, Sha256};
    use uuid::Uuid;

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
            http: reqwest::Client::new(),
            google_keys: tokio::sync::Mutex::new(None),
            workflow_key: None,
            live_email_enabled: false,
            google_forms_client_id: None,
            google_forms_client_secret: None,
            google_forms_refresh_token: None,
        });
        let mut headers = HeaderMap::new();
        headers.insert("origin", "https://pytorch.ph".parse().unwrap());
        headers.insert("cookie", format!("ph_session={token}").parse().unwrap());
        (state, headers, officer, member)
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
