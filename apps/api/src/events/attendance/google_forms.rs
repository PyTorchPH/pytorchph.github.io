//! The Google Forms API as attendance needs it: an access token, the form's email setting,
//! and every submitted response.
//!
//! Module map (caller-first):
//!   access_token              exchanges the configured refresh token for an access token
//!   ├─ configured             one required OAuth setting, or 503 when missing
//!   └─ refresh_token_body
//!   require_verified_form     the form must collect verified signed-in email
//!   └─ collects_verified_email
//!   fetch_responses           all response pages (at most 20)
//!   └─ fetch_response_page
use crate::{ApiError, ApiResult, AppState, bad, internal};
use axum::http::StatusCode;
use serde::Deserialize;

const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const MAX_PAGES: usize = 20;
const PAGE_SIZE: &str = "500";

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
pub(super) struct FormResponse {
    pub response_id: String,
    #[serde(default)]
    pub create_time: String,
    pub last_submitted_time: Option<String>,
    pub respondent_email: Option<String>,
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

pub(super) async fn access_token(state: &AppState) -> ApiResult<String> {
    let client_id = configured(state.google_forms_client_id.as_deref())?;
    let client_secret = configured(state.google_forms_client_secret.as_deref())?;
    let refresh_token = configured(state.google_forms_refresh_token.as_deref())?;
    let response = state
        .http
        .post(TOKEN_URL)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(refresh_token_body(client_id, client_secret, refresh_token))
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

#[inline]
fn configured(value: Option<&str>) -> ApiResult<&str> {
    value.ok_or(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Google Forms OAuth is not configured",
    ))
}

fn refresh_token_body(client_id: &str, client_secret: &str, refresh_token: &str) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    serializer
        .append_pair("client_id", client_id)
        .append_pair("client_secret", client_secret)
        .append_pair("refresh_token", refresh_token)
        .append_pair("grant_type", "refresh_token");
    serializer.finish()
}

pub(super) async fn require_verified_form(
    state: &AppState,
    token: &str,
    form_id: &str,
) -> ApiResult<()> {
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
    if !collects_verified_email(form) {
        return Err(bad("Google Form must collect verified signed-in email"));
    }
    Ok(())
}

#[inline]
fn collects_verified_email(form: FormMetadata) -> bool {
    form.settings
        .and_then(|settings| settings.email_collection_type)
        .as_deref()
        == Some("VERIFIED")
}

// Mental model: follow nextPageToken until it runs out; give up after MAX_PAGES pages.
pub(super) async fn fetch_responses(
    state: &AppState,
    token: &str,
    form_id: &str,
) -> ApiResult<Vec<FormResponse>> {
    let mut all = Vec::new();
    let mut page_token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let page = fetch_response_page(state, token, form_id, page_token.as_deref()).await?;
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

async fn fetch_response_page(
    state: &AppState,
    token: &str,
    form_id: &str,
    page_token: Option<&str>,
) -> ApiResult<ResponsePage> {
    let mut request = state
        .http
        .get(format!(
            "https://forms.googleapis.com/v1/forms/{form_id}/responses"
        ))
        .bearer_auth(token)
        .query(&[("pageSize", PAGE_SIZE)]);
    if let Some(token) = page_token {
        request = request.query(&[("pageToken", token)]);
    }
    request
        .send()
        .await
        .map_err(internal)?
        .error_for_status()
        .map_err(internal)?
        .json::<ResponsePage>()
        .await
        .map_err(internal)
}
