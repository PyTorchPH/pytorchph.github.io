//! Evidence photos: validate and store the JPEG as owner-only media, then add it to the
//! member's evidence list as a draft item.
//!
//! Module map (caller-first):
//!   save_evidence_photo
//!   ├─ decode_jpeg              data URL → bytes, with size and JPEG marker checks
//!   │   └─ is_plausible_jpeg
//!   ├─ ensure_photo_quota       at most 50 photos per member
//!   ├─ store_photo
//!   ├─ photo_evidence_item      a draft evidence item pointing at the stored photo
//!   ├─ evidence::save_manual_evidence
//!   └─ remove_photo             undo the upload when the evidence item is rejected
use super::evidence::save_manual_evidence;
use crate::portal::fields::{field, limited};
use crate::{ApiError, ApiResult, AppState, bad, identity::session::Viewer, internal};
use axum::http::StatusCode;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use uuid::Uuid;

const MAX_PHOTOS_PER_MEMBER: i64 = 50;
const MAX_DATA_URL_LENGTH: usize = 350_000;

// Mental model: accept only a real, small JPEG within the member's quota; store it, then
// create the evidence item that shows it. If that item is rejected, the stored photo goes too.
pub(crate) async fn save_evidence_photo(
    state: &AppState,
    actor: &Viewer,
    input: Value,
) -> ApiResult<Value> {
    let title = field(&input, "title")?.trim();
    let photo = field(&input, "photoData")?;
    if !limited(title, 200) || photo.len() > MAX_DATA_URL_LENGTH {
        return Err(bad("Invalid evidence photo"));
    }
    let bytes = decode_jpeg(photo)?;
    ensure_photo_quota(state, actor).await?;
    let id = store_photo(state, actor, bytes).await?;
    let item = photo_evidence_item(state, &id, title);
    match save_manual_evidence(&state.db, &actor.id, &actor.role, None, item).await {
        Ok(value) => Ok(json!({"item":value["item"],"metadataStripped":true})),
        Err(error) => {
            remove_photo(state, actor, &id).await;
            Err(error)
        }
    }
}

fn decode_jpeg(photo: &str) -> ApiResult<Vec<u8>> {
    let encoded = photo
        .strip_prefix("data:image/jpeg;base64,")
        .ok_or_else(|| bad("Evidence photo must be JPEG"))?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| bad("Invalid JPEG encoding"))?;
    if !is_plausible_jpeg(&bytes) {
        return Err(bad("Invalid JPEG photo"));
    }
    Ok(bytes)
}

/// 100 B–256 KB, starting with the JPEG SOI marker and ending with EOI.
#[inline]
fn is_plausible_jpeg(bytes: &[u8]) -> bool {
    (100..=262_144).contains(&bytes.len())
        && bytes.starts_with(&[0xff, 0xd8, 0xff])
        && bytes.ends_with(&[0xff, 0xd9])
}

async fn ensure_photo_quota(state: &AppState, actor: &Viewer) -> ApiResult<()> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM portal_media WHERE owner_id=?")
        .bind(&actor.id)
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;
    if count.0 >= MAX_PHOTOS_PER_MEMBER {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Evidence photo limit reached",
        ));
    }
    Ok(())
}

async fn store_photo(state: &AppState, actor: &Viewer, bytes: Vec<u8>) -> ApiResult<String> {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO portal_media(id,owner_id,mime,bytes,created_at) VALUES (?,?,?,?,?)")
        .bind(&id)
        .bind(&actor.id)
        .bind("image/jpeg")
        .bind(bytes)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db)
        .await
        .map_err(internal)?;
    Ok(id)
}

fn photo_evidence_item(state: &AppState, id: &str, title: &str) -> Value {
    let origin = state.public_api_origin.trim_end_matches('/');
    json!({"item":{"title":title,"organization":"","role":"","dateLabel":chrono::Utc::now().format("%B %Y").to_string(),"description":"","quantitative":[],"qualitative":[],"skills":[],"mediaUrl":format!("{origin}/portal/media/{id}"),"mediaAlt":format!("User-selected evidence photo: {title}"),"verificationState":"draft"}})
}

async fn remove_photo(state: &AppState, actor: &Viewer, id: &str) {
    let _ = sqlx::query("DELETE FROM portal_media WHERE id=? AND owner_id=?")
        .bind(id)
        .bind(&actor.id)
        .execute(&state.db)
        .await;
}
