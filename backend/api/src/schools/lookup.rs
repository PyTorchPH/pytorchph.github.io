//! One school by its code: validates a member's choice and labels saved answers.
use super::School;
use crate::{ApiResult, internal};
use sqlx::SqlitePool;

pub(crate) async fn find_school(db: &SqlitePool, code: &str) -> ApiResult<Option<School>> {
    sqlx::query_as(
        "SELECT code, name, acronym, level, sector, city, province FROM schools WHERE code = ?",
    )
    .bind(code)
    .fetch_optional(db)
    .await
    .map_err(internal)
}
