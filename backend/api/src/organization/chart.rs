//! What the Organization page shows an officer.
//!
//! Module map (caller-first):
//!   org_chart            departments → positions (holders, parent, seats, what the viewer may do)
//!   ├─ positions         every position with its parent and seats
//!   ├─ holders           who holds each position
//!   ├─ managed_by        positions whose parent the viewer holds
//!   └─ history           recent log entries for the positions the viewer manages (admins: all)
//!   assignable_members   member search for the Assign dialog (every word must match)
use crate::{
    ApiError, ApiResult,
    identity::{
        identity_client::{IdentityClient, NamePurpose},
        session::Viewer,
    },
    internal, reference_data,
};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use std::collections::HashSet;
use uuid::Uuid;

const HISTORY_LIMIT: i64 = 50;
const CANDIDATE_LIMIT: i64 = 20;

type PositionRow = (String, String, String, String, i64, String, Option<String>);

// Mental model: the chart is read once; "canManage" marks exactly the positions the viewer's own
// positions sit directly above, which is what the server will allow.
#[cfg(test)]
pub(crate) async fn org_chart(db: &SqlitePool, viewer: &Viewer) -> ApiResult<Value> {
    org_chart_with_identity(db, None, viewer).await
}

pub(crate) async fn org_chart_with_identity(
    db: &SqlitePool,
    identity: Option<&IdentityClient>,
    viewer: &Viewer,
) -> ApiResult<Value> {
    let rows = positions(db).await?;
    let mut holders = holders(db).await?;
    resolve_consented_names(identity, viewer, &mut holders).await?;
    let held: HashSet<String> = holders
        .iter()
        .filter(|(_, id, _, _)| id == &viewer.id)
        .map(|(slug, ..)| slug.clone())
        .collect();
    let mut managed = managed_by(&rows, &held);
    if held.contains("president") {
        managed.insert("president".to_owned());
    }
    let positions: Vec<Value> = rows
        .iter()
        .map(|(slug, title, department, department_name, rank, seats, parent)| {
            let holders: Vec<Value> = holders
                .iter()
                .filter(|(position, ..)| position == slug)
                .map(|(_, id, name, handle)| json!({"id": id, "name": name, "handle": handle}))
                .collect();
            json!({
                "slug": slug, "title": title, "department": department, "departmentName": department_name,
                "rank": rank, "seats": seats, "parent": parent, "holders": holders,
                "maxHolders": if slug == "president" { Some(2) } else if seats == "one" { Some(1) } else { None },
                "canManage": managed.contains(slug), "heldByViewer": held.contains(slug),
            })
        })
        .collect();
    Ok(json!({"positions": positions, "history": history(db, viewer, &managed).await?}))
}

async fn resolve_consented_names(
    identity: Option<&IdentityClient>,
    viewer: &Viewer,
    holders: &mut [(String, String, String, String)],
) -> ApiResult<()> {
    let Some(identity) = identity else {
        return Ok(());
    };
    let viewer_id = Uuid::parse_str(&viewer.id)
        .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "Invalid viewer identity"))?;
    let mut unique = std::collections::HashSet::new();
    let ids: Vec<Uuid> = holders
        .iter()
        .filter_map(|(_, id, _, _)| Uuid::parse_str(id).ok())
        .filter(|id| unique.insert(*id))
        .take(100)
        .collect();
    let mut resolved = std::collections::HashMap::new();
    for chunk in ids.chunks(8) {
        let mut tasks = tokio::task::JoinSet::new();
        for id in chunk {
            let client = identity.clone();
            let id = *id;
            tasks.spawn(async move {
                (
                    id,
                    client
                        .display_name(id, viewer_id, NamePurpose::OrganizationChart)
                        .await,
                )
            });
        }
        while let Some(result) = tasks.join_next().await {
            let (id, name) = result.map_err(|_| {
                ApiError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Identity lookup unavailable",
                )
            })?;
            match name {
                Ok(Some(name)) => {
                    resolved.insert(id.to_string(), name);
                }
                Ok(None) => {}
                Err(_) => {
                    return Err(ApiError(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "Identity lookup unavailable",
                    ));
                }
            }
        }
    }
    for (_, id, name, _) in holders.iter_mut() {
        if let Some(consented) = resolved.get(id) {
            *name = consented.clone();
        }
    }
    Ok(())
}

async fn positions(db: &SqlitePool) -> ApiResult<Vec<PositionRow>> {
    sqlx::query_as(
        "SELECT p.slug, p.title, p.department_slug, d.name, p.rank, p.seats, r.reports_to_slug \
         FROM positions p JOIN departments d ON d.slug = p.department_slug \
         LEFT JOIN position_reports_to r ON r.position_slug = p.slug ORDER BY p.rank, d.name, p.title",
    )
    .fetch_all(db)
    .await
    .map_err(internal)
}

async fn holders(db: &SqlitePool) -> ApiResult<Vec<(String, String, String, String)>> {
    sqlx::query_as(
        "SELECT mp.position_slug, m.id, m.public_handle, m.public_handle FROM member_positions mp \
         JOIN members m ON m.id = mp.member_id ORDER BY mp.assigned_at",
    )
    .fetch_all(db)
    .await
    .map_err(internal)
}

fn managed_by(rows: &[PositionRow], held: &HashSet<String>) -> HashSet<String> {
    rows.iter()
        .filter(|(.., parent)| parent.as_ref().is_some_and(|parent| held.contains(parent)))
        .map(|(slug, ..)| slug.clone())
        .collect()
}

async fn history(
    db: &SqlitePool,
    viewer: &Viewer,
    managed: &HashSet<String>,
) -> ApiResult<Vec<Value>> {
    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT position_slug, 'Member', action, 'Officer', at FROM position_assignment_log ORDER BY at DESC LIMIT 500",
    )
    .fetch_all(db)
    .await
    .map_err(internal)?;
    let is_admin = viewer.role == "admin";
    Ok(rows
        .into_iter()
        .filter(|(position, ..)| is_admin || managed.contains(position))
        .take(HISTORY_LIMIT as usize)
        .map(|(position, member, action, actor, at)| json!({"position": position, "member": member, "action": action, "actor": actor, "at": at}))
        .collect())
}

/// Officers pick a member by name, handle, or email; every typed word must appear.
pub(crate) async fn assignable_members(db: &SqlitePool, text: &str) -> ApiResult<Value> {
    let words = reference_data::keywords::keywords(text);
    if words.is_empty() {
        return Ok(json!([]));
    }
    let filters = vec![
        "lower(display_name || ' ' || public_handle || ' ' || email) LIKE '%' || ? || '%'";
        words.len()
    ]
    .join(" AND ");
    let mut query = sqlx::query_as::<_, (String, String, String, String)>(sqlx::AssertSqlSafe(
        format!(
            "SELECT id, display_name, public_handle, email FROM members WHERE {filters} ORDER BY display_name LIMIT ?"
        ),
    ));
    for word in &words {
        query = query.bind(word.clone());
    }
    let rows = query
        .bind(CANDIDATE_LIMIT)
        .fetch_all(db)
        .await
        .map_err(internal)?;
    Ok(Value::Array(
        rows.into_iter()
            .map(|(id, name, handle, email)| json!({"id": id, "name": name, "handle": handle, "email": email}))
            .collect(),
    ))
}
