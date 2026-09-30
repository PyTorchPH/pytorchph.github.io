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
    ApiError, ApiResult, AppState, events,
    evidence::integrity,
    feedback::attachments,
    identity::{accounts, session::Viewer},
    member_profile, organization, skill_taxonomy,
};
use axum::http::StatusCode;
use serde_json::Value;

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
        ("PUT", "member/privacy") => (
            StatusCode::OK,
            member::save_privacy(db, &actor.id, input).await?,
        ),
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
        ("POST", "officer/skills/taxonomy") => (
            StatusCode::CREATED,
            skill_taxonomy::publish_taxonomy(db, actor, &input).await?,
        ),
        ("POST", "officer/organization/resign") => (
            StatusCode::OK,
            organization::assignments::resign_position(db, actor, text_field(&input, "position"))
                .await?,
        ),
        ("PUT", "member/profile") => (
            StatusCode::OK,
            member_profile::save_profile(db, actor, &input).await?,
        ),
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
