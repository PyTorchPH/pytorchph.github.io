//! Current assignments + identity-owned public preferences; no manual profile fallback.
use crate::{ApiError, ApiResult, AppState, internal};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Arc};
use uuid::Uuid;

type Holder = (String, String, String, String, i64);

// Mental model: current role holders → consented identity cards → explicit chapter-to-lead joins.
pub(super) async fn project(state: &AppState) -> ApiResult<(Vec<Value>, Vec<Value>)> {
    let rows = holders(state).await?;
    let identities = resolve_identities(state, &rows).await?;
    let mut leadership = Vec::new();
    for (id, position, title, department, rank) in rows {
        if let Some(Some(profile)) = identities.get(&id) {
            let token = photo_token(&id);
            leadership.push(json!({"id":format!("{position}-{token}"),"name":profile.display_name,"title":title,"affiliation":"","position":position,"group":role_group(&position,rank),"department":department,"photoUrl":profile.photo_available.then(||format!("/public/organization-photos/{token}"))}));
        }
    }
    let rows:Vec<(String,String,String,String,String,String)>=sqlx::query_as("SELECT DISTINCT c.id,c.university,c.chapter,c.island,c.status,l.member_id FROM campus_chapters c JOIN campus_chapter_leads l ON l.chapter_id=c.id JOIN member_positions p ON p.member_id=l.member_id AND p.position_slug IN ('campus_labs_lead','campus_lab_ambassador') JOIN members m ON m.id=l.member_id WHERE c.status!='paused' AND m.role IN ('officer','admin') ORDER BY c.island,c.university LIMIT 100")
        .fetch_all(&state.db).await.map_err(internal)?;
    let chapters=rows.into_iter().filter_map(|(id,university,chapter,island,status,lead_id)| {
        let profile=identities.get(&lead_id)?.as_ref()?;
        Some(json!({"id":id,"university":university,"chapter":chapter,"island":island,"status":status,"leadName":profile.display_name,"photoUrl":profile.photo_available.then(||format!("/public/organization-photos/{}",photo_token(&lead_id)))}))
    }).collect();
    Ok((leadership, chapters))
}

async fn resolve_identities(
    state: &AppState,
    rows: &[Holder],
) -> ApiResult<HashMap<String, Option<crate::identity::identity_client::PublicRoleProfile>>> {
    let Some(client) = state.identity_client.as_ref() else {
        return Ok(HashMap::new());
    };
    let unique: std::collections::BTreeSet<_> = rows.iter().map(|(id, ..)| id.clone()).collect();
    let ids: Vec<_> = unique.into_iter().collect();
    let lookup = async {
        let mut resolved = HashMap::new();
        for chunk in ids.chunks(8) {
            let mut tasks = tokio::task::JoinSet::new();
            for id in chunk {
                let client = client.clone();
                let id = id.clone();
                tasks.spawn(async move {
                    let uuid = Uuid::parse_str(&id).map_err(internal)?;
                    let profile = client.public_role_profile(uuid).await.map_err(|_| {
                        ApiError(
                            StatusCode::SERVICE_UNAVAILABLE,
                            "Public identity lookup unavailable",
                        )
                    })?;
                    Ok::<_, ApiError>((id, profile))
                });
            }
            while let Some(result) = tasks.join_next().await {
                let (id, profile) = result.map_err(internal)??;
                resolved.insert(id, profile);
            }
        }
        Ok(resolved)
    };
    tokio::time::timeout(std::time::Duration::from_secs(4), lookup)
        .await
        .map_err(|_| {
            ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "Public identity lookup timed out",
            )
        })?
}

// Every byte request rechecks current assignment and identity consent; tokens confer no permission.
pub(crate) async fn photo(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
) -> ApiResult<Response> {
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ApiError(StatusCode::NOT_FOUND, "Public photo unavailable"));
    }
    let member = holders(&state)
        .await?
        .into_iter()
        .find(|(id, ..)| photo_token(id) == token)
        .map(|(id, ..)| id)
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Public photo unavailable"))?;
    let client = state.identity_client.as_ref().ok_or(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Identity service unavailable",
    ))?;
    let bytes = client
        .public_role_photo(Uuid::parse_str(&member).map_err(internal)?)
        .await
        .map_err(|_| {
            ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "Public photo lookup unavailable",
            )
        })?
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Public photo unavailable"))?;
    let mut response = Body::from(bytes).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, "image/webp".parse().unwrap());
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "private, no-store".parse().unwrap());
    response
        .headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    Ok(response)
}

async fn holders(state: &AppState) -> ApiResult<Vec<Holder>> {
    sqlx::query_as("SELECT m.id,p.slug,p.title,d.name,p.rank FROM member_positions a JOIN members m ON m.id=a.member_id JOIN positions p ON p.slug=a.position_slug JOIN departments d ON d.slug=p.department_slug WHERE m.role IN ('officer','admin') ORDER BY p.rank,p.slug,a.assigned_at LIMIT 100")
        .fetch_all(&state.db).await.map_err(internal)
}

fn photo_token(id: &str) -> String {
    hex::encode(Sha256::digest(format!(
        "pytorch-ph-public-org-photo-v1:{id}"
    )))
}

fn role_group(position: &str, rank: i64) -> &'static str {
    if matches!(position, "president" | "foundation_ambassador") {
        "ambassador"
    } else if rank == 2 {
        "core"
    } else {
        "department"
    }
}
