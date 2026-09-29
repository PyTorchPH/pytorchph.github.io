//! A member's own settings: privacy choices and leaderboard identity.
//!
//! Module map (caller-first):
//!   save_privacy
//!   └─ is_valid_privacy            required booleans, known keys, optional shareAchievements
//!   save_leaderboard_identity
//!   ├─ parse_identity              username, display mode, real-name consent
//!   ├─ username_available
//!   └─ apply_identity              username, mode, consent, review flag, preview
//!       └─ identity_preview
//!   username_available             no other member holds it (case-insensitive)
//!   └─ is_valid_username
use super::{
    fields::field,
    store::{current, save},
};
use crate::{ApiError, ApiResult, bad, internal};
use axum::http::StatusCode;
use serde_json::{Map, Value, json};
use sqlx::SqlitePool;

const PRIVACY_KEY: &str = "/api/member/privacy";
const IDENTITY_KEY: &str = "/api/member/leaderboard-identity";
const REQUIRED_PRIVACY: [&str; 5] = [
    "hideGoogleIdentity",
    "hideRealName",
    "deviceCacheEnabled",
    "anonymousRanking",
    "automaticErrorReports",
];
// shareAchievements is optional so older saved settings stay valid; absent means off.
const OPTIONAL_PRIVACY: [&str; 1] = ["shareAchievements"];
const IDENTITY_MODES: [&str; 3] = ["nickname", "anonymous", "real_name"];

pub(crate) async fn save_privacy(
    db: &SqlitePool,
    member_id: &str,
    input: Value,
) -> ApiResult<Value> {
    let object = input
        .as_object()
        .ok_or_else(|| bad("Invalid privacy settings"))?;
    if !is_valid_privacy(object) {
        return Err(bad("Invalid privacy settings"));
    }
    save(db, member_id, PRIVACY_KEY, &input).await?;
    Ok(input)
}

fn is_valid_privacy(object: &Map<String, Value>) -> bool {
    let required_are_booleans = REQUIRED_PRIVACY
        .iter()
        .all(|key| object.get(*key).is_some_and(Value::is_boolean));
    let only_known_keys = object.keys().all(|key| {
        REQUIRED_PRIVACY.contains(&key.as_str()) || OPTIONAL_PRIVACY.contains(&key.as_str())
    });
    let optional_are_booleans = OPTIONAL_PRIVACY
        .iter()
        .all(|key| object.get(*key).is_none_or(Value::is_boolean));
    required_are_booleans && only_known_keys && optional_are_booleans
}

struct IdentityChoice<'a> {
    username: &'a str,
    mode: &'a str,
    consent: bool,
}

// Mental model: validate the requested identity, make sure nobody else holds the username,
// then update the member's stored identity view.
pub(crate) async fn save_leaderboard_identity(
    db: &SqlitePool,
    member_id: &str,
    role: &str,
    input: Value,
) -> ApiResult<Value> {
    let choice = parse_identity(&input)?;
    if !username_available(db, member_id, choice.username).await? {
        return Err(ApiError(StatusCode::CONFLICT, "Username is unavailable"));
    }
    let mut value = current(db, role, member_id, IDENTITY_KEY).await?;
    apply_identity(&mut value, &choice);
    save(db, member_id, IDENTITY_KEY, &value).await?;
    Ok(value)
}

fn parse_identity(input: &Value) -> ApiResult<IdentityChoice<'_>> {
    let object = input
        .as_object()
        .ok_or_else(|| bad("Invalid leaderboard identity"))?;
    let username = field(input, "username")?.trim();
    let mode = field(input, "mode")?;
    let consent = object
        .get("realNameConsent")
        .and_then(Value::as_bool)
        .ok_or_else(|| bad("Invalid leaderboard identity"))?;
    let choice = IdentityChoice {
        username,
        mode,
        consent,
    };
    if object.len() != 3
        || !is_valid_username(username)
        || !IDENTITY_MODES.contains(&mode)
        || lacks_real_name_consent(&choice)
    {
        return Err(bad("Invalid leaderboard identity"));
    }
    Ok(choice)
}

#[inline]
fn lacks_real_name_consent(choice: &IdentityChoice<'_>) -> bool {
    choice.mode == "real_name" && !choice.consent
}

fn apply_identity(value: &mut Value, choice: &IdentityChoice<'_>) {
    value["username"] = json!(choice.username);
    value["mode"] = json!(choice.mode);
    value["realNameConsent"] = json!(choice.consent);
    value["reviewRequired"] = json!(choice.mode == "real_name");
    value["preview"] = json!(identity_preview(choice));
}

#[inline]
fn identity_preview<'a>(choice: &IdentityChoice<'a>) -> &'a str {
    if choice.mode == "anonymous" {
        "Anonymous member"
    } else {
        choice.username
    }
}

pub(crate) async fn username_available(
    db: &SqlitePool,
    member_id: &str,
    username: &str,
) -> ApiResult<bool> {
    if !is_valid_username(username) {
        return Ok(false);
    }
    let found: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM portal_state WHERE state_key='/api/member/leaderboard-identity' AND scope != ? AND lower(json_extract(value_json,'$.username'))=lower(?) LIMIT 1")
        .bind(member_id).bind(username).fetch_optional(db).await.map_err(internal)?;
    Ok(found.is_none())
}

/// 3–24 letters, digits, underscores or hyphens.
#[inline]
fn is_valid_username(username: &str) -> bool {
    (3..=24).contains(&username.len())
        && username
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}
