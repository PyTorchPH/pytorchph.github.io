//! Process startup: logging, database, seed data, shared state, workers, then serve.
use crate::{
    AppState,
    app::{jobs, routes},
    http::admission::{self, Admission, Config},
    identity::{email_signup, identity_client::IdentityClient},
};
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use std::{env, net::SocketAddr, str::FromStr, sync::Arc, time::Duration};
use tracing::info;

type StartupResult<T> = Result<T, Box<dyn std::error::Error>>;

// Mental model: everything the server needs is prepared in order (logs → database → state),
// background workers start, and only then does the socket open for requests.
pub(crate) async fn run() -> StartupResult<()> {
    init_tracing();
    let presidential_required = crate::organization::presidency::parse_required(
        env::var("PRESIDENT_REQUIRED_APPROVALS").ok().as_deref(),
    )?;
    let admission_config = Config::from_env();
    let db = open_database(&admission_config).await?;
    prepare_database(&db).await?;
    crate::organization::presidency::configure(&db, presidential_required).await?;
    let state = build_state(db.clone())?;
    tokio::spawn(jobs::run_job_worker(db));
    let gate = Admission::new(admission_config, state.clone());
    gate.restore_consistency().await?;
    let app = routes::router(state, gate.clone())?;
    for _ in 0..gate.config.spool_workers {
        tokio::spawn(admission::spool_worker(gate.clone(), app.clone()));
    }
    serve(app).await
}

fn init_tracing() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pytorch_ph_api=info,tower_http=warn".into()),
        )
        .init();
}

// Every running request and spool worker can hold a connection, plus one for the job worker.
async fn open_database(config: &Config) -> StartupResult<SqlitePool> {
    let options = SqliteConnectOptions::from_str(&env::var("DATABASE_URL")?)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let connections = (config.max_inflight + config.spool_workers + 1).max(3);
    let db = SqlitePoolOptions::new()
        .max_connections(connections as u32)
        .connect_with(options)
        .await?;
    info!(config = ?config, "admission.configured");
    Ok(db)
}

// Schema, recovered queues, and optional seed data.
async fn prepare_database(db: &SqlitePool) -> StartupResult<()> {
    crate::migration_compat::run(db).await?;
    // Reference directories: each reloads only when its bundled seed changed.
    crate::schools::load_school_directory(db)
        .await
        .map_err(|error| error.to_string())?;
    crate::programs::load_program_catalog(db)
        .await
        .map_err(|error| error.to_string())?;
    crate::companies::load_company_directory(db)
        .await
        .map_err(|error| error.to_string())?;
    let recovered = admission::recover(db).await.map_err(|error| error.1)?;
    info!(recovered, "admission.spool_recovered");
    if env::var("SEED_TEMP_TEST_ACCOUNTS").ok().as_deref() == Some("true") {
        email_signup::seed_test_accounts(db, &env::var("TEMP_TEST_PASSWORD")?).await?;
    }
    sqlx::query(
        "UPDATE jobs SET status='pending' WHERE status='running' AND kind='leaderboard_refresh'",
    )
    .execute(db)
    .await?;
    Ok(())
}

fn build_state(db: SqlitePool) -> StartupResult<Arc<AppState>> {
    Ok(Arc::new(AppState {
        ai_privacy_key: crate::ai_privacy::key::PrivacyKey::from_env()?,
        db,
        identity_client: configured_identity_client()?,
        google_client_id: env::var("GOOGLE_CLIENT_ID")?,
        bootstrap_admin_email: env::var("BOOTSTRAP_ADMIN_EMAIL")?,
        allowed_origin: env::var("ALLOWED_ORIGIN")?,
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
        mail_relay: email_signup::RelayConfig::from_env()?,
        password_slots: tokio::sync::Semaphore::new(2),
    }))
}

fn configured_identity_client() -> StartupResult<Option<Arc<IdentityClient>>> {
    let names = [
        "IDENTITY_SERVICE_URL",
        "IDENTITY_CLIENT_CERT_FILE",
        "IDENTITY_CLIENT_KEY_FILE",
        "IDENTITY_SERVER_CA_FILE",
    ];
    let present = names.iter().filter(|name| env::var(name).is_ok()).count();
    if present == 0 {
        if env::var("IDENTITY_REQUIRED").ok().as_deref() == Some("true") {
            return Err("identity service configuration required".into());
        }
        return Ok(None);
    }
    if present != names.len() {
        return Err("incomplete identity service configuration".into());
    }
    let client = IdentityClient::from_pem(
        &env::var(names[0])?,
        &std::fs::read(env::var(names[1])?)?,
        &std::fs::read(env::var(names[2])?)?,
        &std::fs::read(env::var(names[3])?)?,
    )
    .map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid identity service TLS configuration",
        )
    })?;
    Ok(Some(Arc::new(client)))
}

async fn serve(app: axum::Router) -> StartupResult<()> {
    let address: SocketAddr = env::var("APP_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8787".to_owned())
        .parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    info!(address = %address, "api.started");
    axum::serve(listener, app).await?;
    Ok(())
}
