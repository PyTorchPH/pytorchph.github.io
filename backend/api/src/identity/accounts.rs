//! External accounts a member verified through the browser extension, which reads the
//! signed-in identity from the member's own session on that site. The server checks that
//! the profile URL is the canonical URL for the handle; it cannot see the third-party
//! session itself, so evidence collected from these accounts still goes to officer review.
//!
//! Module map (caller-first):
//!   list                    the member's verified accounts
//!   └─ account_json
//!   verify                  record one provider account for the member
//!   ├─ read_claimed_account handle (lowercased) and profile URL from the request
//!   ├─ canonical_url        the one profile URL a handle may map to
//!   ├─ valid_handle
//!   │   └─ is_numeric_facebook_id
//!   └─ upsert_account       one member per external account
//!   remove                  forget one provider account
use crate::{ApiError, ApiResult, bad, identity::session::Viewer, internal};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::SqlitePool;

const MAX_HANDLE_BYTES: usize = 100;
const FACEBOOK_ID_PREFIX: &str = "id:";

pub(crate) async fn list(db: &SqlitePool, actor: &Viewer) -> ApiResult<Value> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT provider, handle, profile_url, verified_at FROM member_accounts WHERE member_id = ? ORDER BY provider",
    )
    .bind(&actor.id)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    Ok(Value::Array(
        rows.into_iter()
            .map(|(provider, handle, profile_url, verified_at)| {
                account_json(&provider, &handle, &profile_url, &verified_at)
            })
            .collect(),
    ))
}

#[inline]
fn account_json(provider: &str, handle: &str, profile_url: &str, verified_at: &str) -> Value {
    json!({"provider": provider, "handle": handle, "profileUrl": profile_url, "verifiedAt": verified_at})
}

// Mental model: the extension reports who is signed in; the server accepts that only when the
// profile URL is exactly the canonical one for the handle, and never for two members at once.
pub(crate) async fn verify(
    db: &SqlitePool,
    actor: &Viewer,
    provider: &str,
    input: &Value,
) -> ApiResult<Value> {
    let (handle, profile_url) = read_claimed_account(input);
    let canonical =
        canonical_url(provider, &handle).ok_or_else(|| bad("Unknown account provider"))?;
    if !valid_handle(provider, &handle) || !profile_url.eq_ignore_ascii_case(&canonical) {
        return Err(bad("The profile URL does not match the verified handle"));
    }
    let now = chrono::Utc::now().to_rfc3339();
    upsert_account(db, &actor.id, provider, &handle, &canonical, &now).await?;
    tracing::info!(
        component = "accounts",
        operation = "verify",
        provider,
        "member.account_verified"
    );
    Ok(account_json(provider, &handle, &canonical, &now))
}

fn read_claimed_account(input: &Value) -> (String, &str) {
    let handle = input
        .get("handle")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let profile_url = input
        .get("profileUrl")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    (handle, profile_url)
}

/// The one profile URL a provider handle may map to.
fn canonical_url(provider: &str, handle: &str) -> Option<String> {
    match provider {
        "github" => Some(format!("https://github.com/{handle}")),
        "linkedin" => Some(format!("https://www.linkedin.com/in/{handle}/")),
        "facebook" => Some(match handle.strip_prefix(FACEBOOK_ID_PREFIX) {
            Some(id) => format!("https://www.facebook.com/profile.php?id={id}"),
            None => format!("https://www.facebook.com/{handle}"),
        }),
        _ => None,
    }
}

fn valid_handle(provider: &str, handle: &str) -> bool {
    let allowed = |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.');
    (1..=MAX_HANDLE_BYTES).contains(&handle.len())
        && (is_numeric_facebook_id(provider, handle) || handle.bytes().all(allowed))
}

// Facebook profiles without a username are "id:<digits>".
#[inline]
fn is_numeric_facebook_id(provider: &str, handle: &str) -> bool {
    provider == "facebook"
        && handle.starts_with(FACEBOOK_ID_PREFIX)
        && handle[FACEBOOK_ID_PREFIX.len()..]
            .bytes()
            .all(|b| b.is_ascii_digit())
}

async fn upsert_account(
    db: &SqlitePool,
    member_id: &str,
    provider: &str,
    handle: &str,
    canonical: &str,
    now: &str,
) -> ApiResult<()> {
    let result = sqlx::query("INSERT INTO member_accounts(member_id,provider,handle,profile_url,verified_at) VALUES (?,?,?,?,?) ON CONFLICT(member_id,provider) DO UPDATE SET handle=excluded.handle, profile_url=excluded.profile_url, verified_at=excluded.verified_at")
        .bind(member_id).bind(provider).bind(handle).bind(canonical).bind(now)
        .execute(db)
        .await;
    match result {
        Ok(_) => Ok(()),
        Err(sqlx::Error::Database(error)) if error.is_unique_violation() => Err(ApiError(
            StatusCode::CONFLICT,
            "This account is already verified by another member",
        )),
        Err(error) => Err(internal(error)),
    }
}

pub(crate) async fn remove(db: &SqlitePool, actor: &Viewer, provider: &str) -> ApiResult<Value> {
    let removed = sqlx::query("DELETE FROM member_accounts WHERE member_id = ? AND provider = ?")
        .bind(&actor.id)
        .bind(provider)
        .execute(db)
        .await
        .map_err(internal)?
        .rows_affected();
    if removed == 0 {
        return Err(ApiError(StatusCode::NOT_FOUND, "Account not connected"));
    }
    Ok(json!({"ok": true}))
}
