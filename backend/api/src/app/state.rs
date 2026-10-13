//! Process-wide state shared by every request handler.
use crate::identity::{email_signup, identity_client::IdentityClient};
use sqlx::SqlitePool;
use std::sync::Arc;

pub(crate) struct AppState {
    pub(crate) ai_privacy_key: Option<crate::ai_privacy::key::PrivacyKey>,
    pub(crate) db: SqlitePool,
    pub(crate) identity_client: Option<Arc<IdentityClient>>,
    pub(crate) google_client_id: String,
    pub(crate) bootstrap_admin_email: String,
    pub(crate) allowed_origin: String,
    pub(crate) public_api_origin: String,
    pub(crate) http: reqwest::Client,
    pub(crate) google_keys:
        tokio::sync::Mutex<Option<(std::time::Instant, jsonwebtoken::jwk::JwkSet)>>,
    pub(crate) workflow_key: Option<String>,
    pub(crate) live_email_enabled: bool,
    pub(crate) google_forms_client_id: Option<String>,
    pub(crate) google_forms_client_secret: Option<String>,
    pub(crate) google_forms_refresh_token: Option<String>,
    pub(crate) email_code_secret: String,
    pub(crate) mail_relay: Option<email_signup::RelayConfig>,
    pub(crate) password_slots: tokio::sync::Semaphore,
}
