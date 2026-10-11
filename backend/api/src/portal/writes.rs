//! Non-GET portal requests: one routing table from (method, path) to the action that owns it.
//!
//! Module map (caller-first):
//!   dispatch_write
//!   ├─ member settings      privacy · profile · leaderboard identity · verified accounts
//!   ├─ organization         assign · remove · resign positions (organization::assignments)
//!   ├─ evidence integrity   officer review · appeals
//!   ├─ feedback             create · update · notes · attachments
//!   ├─ product views        demo actions · opportunities · evidence · photos · sources · analysis
//!   ├─ platform             operational events · rejected actions
//!   ├─ after                path tail after a prefix
//!   └─ between              path middle between a prefix and a suffix
use super::{feedback, member, operations, product};
use crate::{
    ApiError, ApiResult, AppState, collab_mail, events,
    evidence::integrity,
    feedback::attachments,
    identity::{accounts, session::Viewer},
    member_profile, organization, skill_taxonomy,
};
use axum::http::StatusCode;
use serde_json::Value;
use serde_json::json;
use uuid::Uuid;

// Mental model: the table is read top to bottom and the first matching (method, path) wins;
// each arm names the status it answers with and the module that owns the change.
pub(crate) async fn dispatch_write(
    state: &AppState,
    actor: &Viewer,
    method: &str,
    path: &str,
    input: Value,
) -> ApiResult<(StatusCode, Value)> {
    let db = &state.db;
    Ok(match (method, path) {
        ("PUT", "member/private-profile") => {
            let phone = input
                .as_object()
                .filter(|value| value.len() == 1)
                .and_then(|value| value.get("phoneNumber"))
                .ok_or(crate::bad("Invalid private profile"))?;
            let phone = if phone.is_null() {
                None
            } else {
                phone.as_str()
            };
            if phone.is_none() && !input.get("phoneNumber").is_some_and(Value::is_null) {
                return Err(crate::bad("Invalid phone number"));
            }
            if phone.is_some_and(|value| !valid_phone(value)) {
                return Err(crate::bad("Invalid phone number"));
            }
            let client = state.identity_client.as_deref().ok_or(ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "Identity service unavailable",
            ))?;
            let id = Uuid::parse_str(&actor.id).map_err(|_| {
                ApiError(StatusCode::SERVICE_UNAVAILABLE, "Invalid member identity")
            })?;
            let saved = client.save_private_profile(id, phone).await.map_err(|_| {
                ApiError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Identity service unavailable",
                )
            })?;
            (StatusCode::OK, json!(saved))
        }
        ("PUT", "member/consents") => {
            let settings: crate::identity::identity_client::IdentitySettings =
                serde_json::from_value(input)
                    .map_err(|_| crate::bad("Invalid consent settings"))?;
            let client = state.identity_client.as_deref().ok_or(ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "Identity service unavailable",
            ))?;
            let id = Uuid::parse_str(&actor.id).map_err(|_| {
                ApiError(StatusCode::SERVICE_UNAVAILABLE, "Invalid member identity")
            })?;
            let saved = client.settings(id, Some(&settings)).await.map_err(|_| {
                ApiError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Identity service unavailable",
                )
            })?;
            super::consents::project(db, &actor.id, &saved).await?;
            (StatusCode::OK, json!(saved))
        }
        ("PUT", "member/privacy") => {
            let Some(client) = state.identity_client.as_deref() else {
                return Ok((
                    StatusCode::OK,
                    member::save_privacy(db, &actor.id, input).await?,
                ));
            };
            let id = Uuid::parse_str(&actor.id).map_err(|_| {
                ApiError(StatusCode::SERVICE_UNAVAILABLE, "Invalid member identity")
            })?;
            let settings = client.settings(id, None).await.map_err(|_| {
                ApiError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Identity service unavailable",
                )
            })?;
            let anonymous = input
                .get("anonymousRanking")
                .and_then(Value::as_bool)
                .ok_or(crate::bad("Invalid privacy settings"))?;
            let projected = json!({
                "hideGoogleIdentity": settings.hide_google_identity,
                "hideRealName": !settings.real_name_visible,
                "deviceCacheEnabled": false,
                "anonymousRanking": anonymous,
                "automaticErrorReports": settings.automatic_error_reports,
                "shareAchievements": settings.share_achievements,
            });
            (
                StatusCode::OK,
                member::save_privacy(db, &actor.id, projected).await?,
            )
        }
        ("PUT", "member/organization-name-consent") => {
            let granted = input
                .as_object()
                .filter(|value| value.len() == 1)
                .and_then(|value| value.get("granted"))
                .and_then(Value::as_bool)
                .ok_or(crate::bad("Invalid organization name consent"))?;
            let client = state.identity_client.as_deref().ok_or(ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "Identity service unavailable",
            ))?;
            let id = Uuid::parse_str(&actor.id).map_err(|_| {
                ApiError(StatusCode::SERVICE_UNAVAILABLE, "Invalid member identity")
            })?;
            let saved = client
                .organization_name_consent(id, Some(granted))
                .await
                .map_err(|_| {
                    ApiError(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "Identity service unavailable",
                    )
                })?;
            (StatusCode::OK, json!({"granted":saved}))
        }
        ("PUT", "member/organization-photo-consent") => {
            let granted = input
                .as_object()
                .filter(|value| value.len() == 1)
                .and_then(|value| value.get("granted"))
                .and_then(Value::as_bool)
                .ok_or(crate::bad("Invalid organization photo consent"))?;
            let client = state.identity_client.as_deref().ok_or(ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "Identity service unavailable",
            ))?;
            let id = Uuid::parse_str(&actor.id).map_err(|_| {
                ApiError(StatusCode::SERVICE_UNAVAILABLE, "Invalid member identity")
            })?;
            let saved = client
                .organization_photo_consent(id, Some(granted))
                .await
                .map_err(|_| {
                    ApiError(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "Identity service unavailable",
                    )
                })?;
            (StatusCode::OK, json!({"granted":saved}))
        }
        ("PUT", "member/leaderboard-photo-consent") => {
            let granted = input
                .as_object()
                .filter(|value| value.len() == 1)
                .and_then(|value| value.get("granted"))
                .and_then(Value::as_bool)
                .ok_or(crate::bad("Invalid leaderboard photo consent"))?;
            let client = state.identity_client.as_deref().ok_or(ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "Identity service unavailable",
            ))?;
            let id = Uuid::parse_str(&actor.id).map_err(|_| {
                ApiError(StatusCode::SERVICE_UNAVAILABLE, "Invalid member identity")
            })?;
            let saved = client
                .leaderboard_photo_consent(id, Some(granted))
                .await
                .map_err(|_| {
                    ApiError(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "Identity service unavailable",
                    )
                })?;
            (StatusCode::OK, json!({"granted":saved}))
        }
        ("POST", "officer/organization/assignments") => (
            StatusCode::CREATED,
            organization::assignments::assign_position(
                db,
                actor,
                text_field(&input, "memberId"),
                text_field(&input, "position"),
            )
            .await?,
        ),
        ("DELETE", _) if path.starts_with("officer/organization/assignments/") => {
            let (position, member_id) = after(path, "officer/organization/assignments/")
                .split_once('/')
                .unwrap_or_default();
            (
                StatusCode::OK,
                organization::assignments::remove_holder(db, actor, member_id, position).await?,
            )
        }
        ("DELETE", _) if path.starts_with("officer/events/") => (
            StatusCode::OK,
            events::delete::delete_event(db, actor, after(path, "officer/events/")).await?,
        ),
        ("POST", "officer/mail-collab") => (
            StatusCode::CREATED,
            collab_mail::create::create_draft(db, actor, &input).await?,
        ),
        (_, _) if path.starts_with("officer/mail-collab/") => (
            StatusCode::OK,
            collab_mail_action(
                db,
                actor,
                method,
                after(path, "officer/mail-collab/"),
                &input,
            )
            .await?,
        ),
        ("POST", "officer/skills/taxonomy") => (
            StatusCode::CREATED,
            skill_taxonomy::publish_taxonomy(db, actor, &input).await?,
        ),
        ("POST", "officer/organization/resign") => (
            StatusCode::OK,
            organization::assignments::resign_position(db, actor, text_field(&input, "position"))
                .await?,
        ),
        ("PUT", "member/profile") => {
            if let Some(client) = state.identity_client.as_deref() {
                let analytics_consent = input
                    .get("analyticsConsent")
                    .and_then(Value::as_bool)
                    .ok_or(crate::bad("Invalid analytics choice"))?;
                let id = Uuid::parse_str(&actor.id).map_err(|_| {
                    ApiError(StatusCode::SERVICE_UNAVAILABLE, "Invalid member identity")
                })?;
                let mut settings = client.settings(id, None).await.map_err(|_| {
                    ApiError(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "Identity service unavailable",
                    )
                })?;
                settings.analytics_opt_out = !analytics_consent;
                client.settings(id, Some(&settings)).await.map_err(|_| {
                    ApiError(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "Identity service unavailable",
                    )
                })?;
            }
            (
                StatusCode::OK,
                member_profile::save_profile(db, actor, &input).await?,
            )
        }
        ("POST", _) if is_attachments_path(path) => (
            StatusCode::CREATED,
            attachments::add_attachment(
                db,
                actor,
                between(path, "feedback/", "/attachments"),
                &input,
            )
            .await?,
        ),
        ("PUT", _) if path.starts_with("member/accounts/") => (
            StatusCode::OK,
            accounts::verify(db, actor, after(path, "member/accounts/"), &input).await?,
        ),
        ("DELETE", _) if path.starts_with("member/accounts/") => (
            StatusCode::OK,
            accounts::remove(db, actor, after(path, "member/accounts/")).await?,
        ),
        ("PATCH", _) if path.starts_with("officer/evidence/appeals/") => (
            StatusCode::OK,
            integrity::resolve_appeal(db, actor, after(path, "officer/evidence/appeals/"), &input)
                .await?,
        ),
        ("PATCH", _) if path.starts_with("officer/evidence/") => (
            StatusCode::OK,
            integrity::review_claim(db, actor, after(path, "officer/evidence/"), &input).await?,
        ),
        ("POST", "evidence/integrity") => (
            StatusCode::CREATED,
            integrity::open_appeal(db, actor, &input).await?,
        ),
        ("PUT", "member/leaderboard-identity") => (
            StatusCode::OK,
            member::save_leaderboard_identity(db, &actor.id, &actor.role, input).await?,
        ),
        ("POST", "product/demo-action") => (
            StatusCode::OK,
            product::demo_actions::demo_action(db, &actor.id, &actor.role, input).await?,
        ),
        ("POST", "product/opportunities") => (
            StatusCode::CREATED,
            product::opportunities::save_opportunity(db, &actor.id, &actor.role, None, input)
                .await?,
        ),
        ("PATCH", _) if path.starts_with("product/opportunities/") => (
            StatusCode::OK,
            product::opportunities::save_opportunity(
                db,
                &actor.id,
                &actor.role,
                Some(after(path, "product/opportunities/")),
                input,
            )
            .await?,
        ),
        ("POST", "product/evidence") if is_photo_upload(&input) => (
            StatusCode::CREATED,
            product::photo::save_evidence_photo(state, actor, input).await?,
        ),
        ("POST", "product/evidence") => (
            StatusCode::CREATED,
            product::evidence::save_manual_evidence(db, &actor.id, &actor.role, None, input)
                .await?,
        ),
        ("DELETE", _) if path.starts_with("product/evidence/") => (
            StatusCode::OK,
            product::remove_evidence::delete_own_evidence(
                db,
                actor,
                after(path, "product/evidence/"),
            )
            .await?,
        ),
        ("PATCH", _) if path.starts_with("product/evidence/") => (
            StatusCode::OK,
            product::evidence::save_manual_evidence(
                db,
                &actor.id,
                &actor.role,
                Some(after(path, "product/evidence/")),
                input,
            )
            .await?,
        ),
        ("POST", _) if path.starts_with("product/sources/") => (
            StatusCode::OK,
            product::sources::update_source(
                db,
                &actor.id,
                &actor.role,
                after(path, "product/sources/"),
                input,
            )
            .await?,
        ),
        ("POST", "product/evidence/analyze") => (
            StatusCode::OK,
            product::analysis::static_evidence_analysis(input)?,
        ),
        ("POST", "feedback") => (
            StatusCode::CREATED,
            feedback::create_feedback(db, actor, input).await?,
        ),
        ("PATCH", _) if path.starts_with("feedback/") && !is_notes_path(path) => (
            StatusCode::OK,
            feedback::update_feedback(db, actor, after(path, "feedback/"), input).await?,
        ),
        ("POST", _) if path.starts_with("feedback/") && is_notes_path(path) => (
            StatusCode::CREATED,
            feedback::note_feedback(db, actor, between(path, "feedback/", "/notes"), input).await?,
        ),
        ("POST", "job-market/refresh") => {
            return Err(ApiError(
                StatusCode::METHOD_NOT_ALLOWED,
                "Job-market ingestion is controlled by the backend",
            ));
        }
        ("POST", "operations/events") => (
            StatusCode::ACCEPTED,
            operations::operational_event(actor, input)?,
        ),
        _ => {
            return Err(ApiError(
                StatusCode::NOT_IMPLEMENTED,
                "Product action is not connected to the Rust API",
            ));
        }
    })
}

#[inline]
fn valid_phone(value: &str) -> bool {
    (8..=16).contains(&value.len())
        && value.starts_with('+')
        && value[1..].bytes().all(|digit| digit.is_ascii_digit())
}

#[inline]
fn is_attachments_path(path: &str) -> bool {
    path.starts_with("feedback/") && path.ends_with("/attachments")
}

#[inline]
fn is_notes_path(path: &str) -> bool {
    path.ends_with("/notes")
}

#[inline]
fn is_photo_upload(input: &Value) -> bool {
    input.get("photoData").is_some()
}

/// The part of `path` after `prefix`; callers have already matched the prefix.
#[inline]
fn after<'a>(path: &'a str, prefix: &str) -> &'a str {
    &path[prefix.len()..]
}

/// The part of `path` between `prefix` and `suffix`; callers have already matched both.
#[inline]
fn between<'a>(path: &'a str, prefix: &str, suffix: &str) -> &'a str {
    &path[prefix.len()..path.len() - suffix.len()]
}

/// A string field of a JSON body, or "" (the action then rejects it as unknown).
#[inline]
fn text_field<'a>(input: &'a Value, field: &str) -> &'a str {
    input.get(field).and_then(Value::as_str).unwrap_or_default()
}

// officer/mail-collab/{draft}/{action}[/{target}] → the collaborative mail action that owns it.
async fn collab_mail_action(
    db: &sqlx::SqlitePool,
    actor: &Viewer,
    method: &str,
    rest: &str,
    input: &Value,
) -> ApiResult<Value> {
    use collab_mail::{chain, review};
    let parts: Vec<&str> = rest.split('/').collect();
    match (method, parts.as_slice()) {
        ("PUT", [draft, "sections", section]) => {
            review::edit_section(db, actor, draft, section, input).await
        }
        ("POST", [draft, "sections", section, "confirm"]) => {
            review::confirm_section(db, actor, draft, section, input).await
        }
        ("PUT", [draft, "tags", tag]) => review::edit_tag(db, actor, draft, tag, input).await,
        ("POST", [draft, "questions", question]) => {
            review::answer_question(db, actor, draft, question, input).await
        }
        ("POST", [draft, "approve"]) => chain::approve_step(db, actor, draft, input).await,
        ("POST", [draft, "send"]) => chain::send_draft(db, actor, draft, input).await,
        _ => Err(ApiError(StatusCode::NOT_FOUND, "Unknown email action")),
    }
}
