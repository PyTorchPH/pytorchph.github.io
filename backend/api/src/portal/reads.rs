//! GET requests: special reads, table-backed views, then saved state or fixtures.
//!
//! Module map (caller-first):
//!   answer_read
//!   ├─ special_read              provider catalog · username availability · feedback list
//!   │   └─ query_param
//!   ├─ computed_view             leaderboard, overview, integrity, verified accounts, attachments,
//!   │                            member profile, officer demographics
//!   │   ├─ report_attachments_id
//!   │   └─ overview_with_standing
//!   └─ saved_or_fixture_view     saved state (exact query, then plain key), else the fixture
//!       └─ key_with_query
use super::{
    feedback,
    fixtures::fixture,
    member, operations,
    overlays::overlay_if_product,
    reply,
    store::{scope, stored, view_not_found},
};
use crate::{
    ApiResult, events,
    evidence::integrity,
    feedback::attachments,
    identity::{accounts, session::Viewer},
    leaderboard, member_profile, organization, skill_taxonomy,
};
use axum::{http::StatusCode, response::Response};
use serde_json::{Value, json};
use sqlx::SqlitePool;

// Mental model: a few paths answer from dedicated logic, table-backed views are computed
// from their tables, and everything else is the member's saved JSON or the demo fixture.
pub(crate) async fn answer_read(
    db: &SqlitePool,
    actor: &Viewer,
    path: &str,
    query: Option<&str>,
) -> ApiResult<Response> {
    if let Some(value) = special_read(db, actor, path, query).await? {
        return Ok(reply(StatusCode::OK, value));
    }
    let key = format!("/api/{path}");
    // Leaderboard, integrity and review data come from their tables, not JSON state.
    if let Some(value) = computed_view(db, actor, path, &key, query).await? {
        return Ok(reply(StatusCode::OK, value));
    }
    saved_or_fixture_view(db, actor, path, &key, query).await
}

async fn special_read(
    db: &SqlitePool,
    actor: &Viewer,
    path: &str,
    query: Option<&str>,
) -> ApiResult<Option<Value>> {
    Ok(match path {
        // AI keys and calls stay in the member's extension; the server only lists providers.
        "backend/local-ai/providers" => Some(operations::ai_providers()),
        "member/leaderboard-identity" if query.is_some() => {
            let username = query_param(query, "username");
            Some(json!({"available": member::username_available(db, &actor.id, &username).await?}))
        }
        "feedback" => Some(feedback::read_feedback(db, actor, query).await?),
        "officer/organization/members" => {
            Some(organization::chart::assignable_members(db, &query_param(query, "q")).await?)
        }
        _ => None,
    })
}

fn query_param(query: Option<&str>, name: &str) -> String {
    url::form_urlencoded::parse(query.unwrap_or_default().as_bytes())
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
        .unwrap_or_default()
}

async fn computed_view(
    db: &SqlitePool,
    actor: &Viewer,
    path: &str,
    key: &str,
    query: Option<&str>,
) -> ApiResult<Option<Value>> {
    if let Some(report_id) = report_attachments_id(path) {
        return Ok(Some(attachments::attachments(db, actor, report_id).await?));
    }
    let value = match path {
        "member/leaderboard" => leaderboard::member_leaderboard(db, actor, query).await?,
        "member/leaderboard/profile" => leaderboard::member_profile(db, actor, query).await?,
        "member/overview" => overview_with_standing(db, actor, key).await?,
        "officer/evidence" => integrity::officer_claims(db).await?,
        "officer/evidence/appeals" => integrity::officer_appeals(db).await?,
        "evidence/integrity" => integrity::member_integrity(db, &actor.id).await?,
        "member/accounts" => accounts::list(db, actor).await?,
        "member/profile" => member_profile::read_profile(db, actor).await?,
        "officer/demographics" => member_profile::demographics(db).await?,
        "officer/organization" => organization::chart::org_chart(db, actor).await?,
        "officer/events" => events::delete::officer_event_list(db, actor).await?,
        "member/skill-tally" => skill_taxonomy::skill_tally(db).await?,
        "officer/skills/raw" => raw_skills_for(db, actor).await?,
        _ => return Ok(None),
    };
    Ok(Some(value))
}

/// `feedback/{id}/attachments` → `{id}`.
#[inline]
fn report_attachments_id(path: &str) -> Option<&str> {
    if path.starts_with("feedback/") && path.ends_with("/attachments") {
        Some(&path[9..path.len() - 12])
    } else {
        None
    }
}

async fn overview_with_standing(db: &SqlitePool, actor: &Viewer, key: &str) -> ApiResult<Value> {
    let (_, mut overview) = fixture(&actor.role, key).ok_or_else(view_not_found)?;
    leaderboard::overlay_overview(db, actor, &mut overview).await?;
    Ok(overview)
}

// Mental model: the most specific saved value wins (with the query, then without it); only
// when nothing is saved does the demo fixture answer, keeping its own status code.
async fn saved_or_fixture_view(
    db: &SqlitePool,
    actor: &Viewer,
    path: &str,
    key: &str,
    query: Option<&str>,
) -> ApiResult<Response> {
    let owner = scope(&actor.id, key);
    let query_key = key_with_query(key, query);
    for candidate in [query_key.as_str(), key] {
        if let Some(mut value) = stored(db, owner, candidate).await? {
            overlay_if_product(db, actor, path, &mut value).await?;
            return Ok(reply(StatusCode::OK, value));
        }
    }
    let (status, mut value) = fixture(&actor.role, &query_key).ok_or_else(view_not_found)?;
    if status == StatusCode::OK {
        overlay_if_product(db, actor, path, &mut value).await?;
    }
    Ok(reply(status, value))
}

#[inline]
fn key_with_query(key: &str, query: Option<&str>) -> String {
    query
        .map(|query| format!("{key}?{query}"))
        .unwrap_or_else(|| key.to_owned())
}

/// Raw skill words (no member identities) for the client-side compiler; only Technology
/// department officers receive the list.
async fn raw_skills_for(db: &SqlitePool, actor: &Viewer) -> ApiResult<Value> {
    if !skill_taxonomy::can_compile(db, actor).await? {
        return Ok(json!({"canCompile": false, "raw": []}));
    }
    let raw = skill_taxonomy::raw_skill_counts(db).await?;
    Ok(
        json!({"canCompile": true, "raw": raw.into_iter().map(|(raw, members)| json!({"raw": raw, "members": members})).collect::<Vec<_>>()}),
    )
}
