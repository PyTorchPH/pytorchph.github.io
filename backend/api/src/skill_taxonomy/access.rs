//! Compiling and publishing the skill list belongs to the Technology department: whoever holds a
//! Technology position (CTO, Engineering Lead, R&D Lead, Campus Labs Lead). No admin bypass.
use crate::{ApiResult, identity::session::Viewer, internal};
use sqlx::SqlitePool;

const COMPILING_DEPARTMENT: &str = "technology";

pub(crate) async fn can_compile(db: &SqlitePool, viewer: &Viewer) -> ApiResult<bool> {
    let held: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM member_positions mp JOIN positions p ON p.slug = mp.position_slug \
         WHERE mp.member_id = ? AND p.department_slug = ? LIMIT 1",
    )
    .bind(&viewer.id)
    .bind(COMPILING_DEPARTMENT)
    .fetch_optional(db)
    .await
    .map_err(internal)?;
    Ok(held.is_some())
}
