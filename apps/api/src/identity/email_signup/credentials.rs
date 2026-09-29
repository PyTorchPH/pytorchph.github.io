//! Shared credential rules for email accounts.
//!
//! Module map:
//!   normalize_email        lower-cased address with a plausible local part and domain
//!   password_hash          Argon2 hash with a fresh salt
//!   verify_password        Argon2 check against a stored hash
//!   code_hash              HMAC-SHA256 of email + code, keyed by the server secret
//!   is_eight_digit_code
//!   enforce_rate_limit     15-minute attempt window per scope and subject
//!   claim_hashing_slot     at most two Argon2 runs at once
use crate::{ApiError, ApiResult, AppState, internal};
use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::http::StatusCode;
use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use tokio::sync::SemaphorePermit;

type HmacSha256 = Hmac<Sha256>;

const MIN_EMAIL_LENGTH: usize = 5;
const MAX_EMAIL_LENGTH: usize = 254;
const MIN_DOMAIN_LENGTH: usize = 3;
const RATE_WINDOW_MINUTES: i64 = 15;
const CODE_DIGITS: usize = 8;

pub(super) fn normalize_email(raw: &str) -> Option<String> {
    let email = raw.trim().to_ascii_lowercase();
    if !is_plausible_length(&email) || email.contains(char::is_whitespace) {
        return None;
    }
    let (local, domain) = email.split_once('@')?;
    if local.is_empty() || !is_plausible_domain(domain) {
        return None;
    }
    Some(email)
}

#[inline]
fn is_plausible_length(email: &str) -> bool {
    (MIN_EMAIL_LENGTH..=MAX_EMAIL_LENGTH).contains(&email.len())
}

#[inline]
fn is_plausible_domain(domain: &str) -> bool {
    domain.len() >= MIN_DOMAIN_LENGTH
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
}

pub(crate) fn password_hash(password: &str) -> ApiResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|value| value.to_string())
        .map_err(internal)
}

pub(super) fn verify_password(stored_hash: &str, password: &str) -> bool {
    PasswordHash::new(stored_hash).ok().is_some_and(|parsed| {
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok()
    })
}

pub(crate) fn code_hash(secret: &str, email: &str, code: &str) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(email.as_bytes());
    mac.update(b":");
    mac.update(code.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

#[inline]
pub(super) fn is_eight_digit_code(code: &str) -> bool {
    code.len() == CODE_DIGITS && code.bytes().all(|b| b.is_ascii_digit())
}

/// Mental model: one counter per (scope, hashed subject); it restarts after the window and
/// refuses once it passes `maximum`.
pub(super) async fn enforce_rate_limit(
    db: &SqlitePool,
    scope: &str,
    email: &str,
    maximum: i64,
) -> ApiResult<()> {
    let subject = hex::encode(Sha256::digest(email.as_bytes()));
    let cutoff = (Utc::now() - Duration::minutes(RATE_WINDOW_MINUTES)).to_rfc3339();
    let now = Utc::now().to_rfc3339();
    let attempts: i64 = sqlx::query_scalar("INSERT INTO auth_rate_limits(scope,subject_hash,window_started_at,attempts) VALUES (?,?,?,1) ON CONFLICT(scope,subject_hash) DO UPDATE SET attempts=CASE WHEN window_started_at < ? THEN 1 ELSE attempts+1 END,window_started_at=CASE WHEN window_started_at < ? THEN excluded.window_started_at ELSE window_started_at END RETURNING attempts")
        .bind(scope).bind(subject).bind(now).bind(&cutoff).bind(&cutoff)
        .fetch_one(db).await.map_err(internal)?;
    if attempts > maximum {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts. Try again later.",
        ));
    }
    Ok(())
}

pub(super) fn claim_hashing_slot(state: &AppState) -> ApiResult<SemaphorePermit<'_>> {
    state.password_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Authentication is busy. Try again.",
        )
    })
}
