//! Explicit public chapter facts; never infer university affiliation from private education.
use crate::{ApiError, ApiResult, bad, identity::session::Viewer, internal};
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use uuid::Uuid;

pub(crate) async fn view(db: &SqlitePool, actor: &Viewer) -> ApiResult<Value> {
    if !matches!(actor.role.as_str(), "officer" | "admin") {
        return Err(ApiError(StatusCode::FORBIDDEN, "Officer access required"));
    }
    let chapters = rows(db).await?;
    let leads: Vec<(String,String)>=sqlx::query_as("SELECT DISTINCT m.id,m.public_handle FROM members m JOIN member_positions p ON p.member_id=m.id WHERE p.position_slug IN ('campus_labs_lead','campus_lab_ambassador') AND m.role IN ('officer','admin') ORDER BY m.public_handle LIMIT 100")
        .fetch_all(db).await.map_err(internal)?;
    Ok(
        json!({"canManage":can_manage(db,actor).await?,"chapters":chapters,"eligibleLeads":leads.into_iter().map(|(id,name)|json!({"id":id,"name":name})).collect::<Vec<_>>()}),
    )
}

pub(crate) async fn save(db: &SqlitePool, actor: &Viewer, input: &Value) -> ApiResult<Value> {
    let mut tx = db.begin().await.map_err(internal)?;
    let manager:i64=sqlx::query_scalar("SELECT COUNT(*) FROM members m WHERE m.id=? AND (m.role IN ('officer','admin') AND EXISTS (SELECT 1 FROM member_positions p WHERE p.member_id=m.id AND p.position_slug IN ('president','campus_labs_lead')))")
        .bind(&actor.id).fetch_one(&mut *tx).await.map_err(internal)?;
    if manager != 1 {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Campus Labs management required",
        ));
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Chapter {
        id: Option<String>,
        university: String,
        chapter: String,
        island: String,
        status: String,
        lead_id: String,
    }
    let value: Chapter =
        serde_json::from_value(input.clone()).map_err(|_| bad("Invalid chapter assignment"))?;
    for text in [&value.university, &value.chapter] {
        if text.trim().is_empty()
            || text.chars().count() > 200
            || text.chars().any(char::is_control)
        {
            return Err(bad("Invalid chapter text"));
        }
    }
    if !["Luzon", "Visayas", "Mindanao"].contains(&value.island.as_str())
        || !["active", "forming", "paused"].contains(&value.status.as_str())
    {
        return Err(bad("Invalid chapter status or island"));
    }
    let id = match value.id {
        Some(id) if !id.is_empty() => {
            Uuid::parse_str(&id).map_err(|_| bad("Invalid chapter ID"))?
        }
        _ => Uuid::new_v4(),
    }
    .to_string();
    let eligible:i64=sqlx::query_scalar("SELECT COUNT(*) FROM member_positions p JOIN members m ON m.id=p.member_id WHERE p.member_id=? AND p.position_slug IN ('campus_labs_lead','campus_lab_ambassador') AND m.role IN ('officer','admin')")
        .bind(&value.lead_id).fetch_one(&mut *tx).await.map_err(internal)?;
    if eligible == 0 {
        return Err(bad("Choose a current Campus Labs lead"));
    }
    sqlx::query("INSERT INTO campus_chapters(id,university,chapter,island,status,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET university=excluded.university,chapter=excluded.chapter,island=excluded.island,status=excluded.status,updated_at=excluded.updated_at")
        .bind(&id).bind(value.university.trim()).bind(value.chapter.trim()).bind(&value.island).bind(&value.status).bind(chrono::Utc::now().to_rfc3339()).execute(&mut *tx).await.map_err(internal)?;
    sqlx::query("INSERT INTO campus_chapter_leads(chapter_id,member_id) VALUES (?,?) ON CONFLICT(chapter_id) DO UPDATE SET member_id=excluded.member_id")
        .bind(&id).bind(&value.lead_id).execute(&mut *tx).await.map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "campus_chapters",
        operation = "save",
        outcome = "success"
    );
    view(db, actor).await
}

async fn can_manage(db: &SqlitePool, actor: &Viewer) -> ApiResult<bool> {
    let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM member_positions WHERE member_id=? AND position_slug IN ('president','campus_labs_lead')")
        .bind(&actor.id).fetch_one(db).await.map_err(internal)?;
    Ok(matches!(actor.role.as_str(), "officer" | "admin") && count > 0)
}

async fn rows(db: &SqlitePool) -> ApiResult<Vec<Value>> {
    let rows:Vec<(String,String,String,String,String,String)>=sqlx::query_as("SELECT c.id,c.university,c.chapter,c.island,c.status,l.member_id FROM campus_chapters c JOIN campus_chapter_leads l ON l.chapter_id=c.id ORDER BY c.island,c.university LIMIT 100")
        .fetch_all(db).await.map_err(internal)?;
    Ok(rows.into_iter().map(|(id,university,chapter,island,status,lead_id)|json!({"id":id,"university":university,"chapter":chapter,"island":island,"status":status,"leadId":lead_id})).collect())
}
