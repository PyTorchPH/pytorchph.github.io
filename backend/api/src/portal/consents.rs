//! Auth-owned decisions projected into existing website views for leaderboard and demographics.
use super::{member, store};
use crate::{ApiResult, identity::identity_client::IdentitySettings, internal};
use serde_json::{Value, json};
use sqlx::SqlitePool;

pub(super) async fn project(
    db: &SqlitePool,
    member_id: &str,
    settings: &IdentitySettings,
) -> ApiResult<()> {
    let existing = store::stored(db, member_id, "/api/member/privacy").await?;
    let anonymous = existing
        .as_ref()
        .and_then(|value| value.get("anonymousRanking"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let projected = json!({
        "hideGoogleIdentity": settings.hide_google_identity,
        "hideRealName": !settings.real_name_visible,
        "deviceCacheEnabled": false,
        "anonymousRanking": anonymous,
        "automaticErrorReports": settings.automatic_error_reports,
        "shareAchievements": settings.share_achievements,
    });
    member::save_privacy(db, member_id, projected).await?;
    let has_profile: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM member_profiles WHERE member_id=?")
            .bind(member_id)
            .fetch_optional(db)
            .await
            .map_err(internal)?;
    if settings.analytics_opt_out {
        sqlx::query("DELETE FROM member_analytics_consents WHERE member_id=?")
            .bind(member_id)
            .execute(db)
            .await
            .map_err(internal)?;
    } else if has_profile.is_some() {
        sqlx::query("INSERT OR IGNORE INTO member_analytics_consents(member_id,consented_at) VALUES (?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
            .bind(member_id).execute(db).await.map_err(internal)?;
    }
    Ok(())
}
