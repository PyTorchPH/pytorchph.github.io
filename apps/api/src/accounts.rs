//! External accounts a member verified through the browser extension, which reads the
//! signed-in identity from the member's own session on that site. The server checks that
//! the profile URL is the canonical URL for the handle; it cannot see the third-party
//! session itself, so evidence collected from these accounts still goes to officer review.
use crate::{ApiError, ApiResult, auth::Viewer, bad, internal};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::SqlitePool;

fn valid_handle(provider: &str, handle: &str) -> bool {
    let allowed = |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.');
    let numeric_facebook = provider == "facebook"
        && handle.starts_with("id:")
        && handle[3..].bytes().all(|b| b.is_ascii_digit());
    (1..=100).contains(&handle.len()) && (numeric_facebook || handle.bytes().all(allowed))
}

/// The one profile URL a provider handle may map to.
fn canonical_url(provider: &str, handle: &str) -> Option<String> {
    match provider {
        "github" => Some(format!("https://github.com/{handle}")),
        "linkedin" => Some(format!("https://www.linkedin.com/in/{handle}/")),
        "facebook" => Some(match handle.strip_prefix("id:") {
            Some(id) => format!("https://www.facebook.com/profile.php?id={id}"),
            None => format!("https://www.facebook.com/{handle}"),
        }),
        _ => None,
    }
}

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
                json!({"provider": provider, "handle": handle, "profileUrl": profile_url, "verifiedAt": verified_at})
            })
            .collect(),
    ))
}

pub(crate) async fn verify(
    db: &SqlitePool,
    actor: &Viewer,
    provider: &str,
    input: &Value,
) -> ApiResult<Value> {
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
    let canonical =
        canonical_url(provider, &handle).ok_or_else(|| bad("Unknown account provider"))?;
    if !valid_handle(provider, &handle) || !profile_url.eq_ignore_ascii_case(&canonical) {
        return Err(bad("The profile URL does not match the verified handle"));
    }
    let now = chrono::Utc::now().to_rfc3339();
    let result = sqlx::query("INSERT INTO member_accounts(member_id,provider,handle,profile_url,verified_at) VALUES (?,?,?,?,?) ON CONFLICT(member_id,provider) DO UPDATE SET handle=excluded.handle, profile_url=excluded.profile_url, verified_at=excluded.verified_at")
        .bind(&actor.id).bind(provider).bind(&handle).bind(&canonical).bind(&now)
        .execute(db)
        .await;
    match result {
        Ok(_) => {}
        Err(sqlx::Error::Database(error)) if error.is_unique_violation() => {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "This account is already verified by another member",
            ));
        }
        Err(error) => return Err(internal(error)),
    }
    tracing::info!(
        component = "accounts",
        operation = "verify",
        provider,
        "member.account_verified"
    );
    Ok(json!({"provider": provider, "handle": handle, "profileUrl": canonical, "verifiedAt": now}))
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
