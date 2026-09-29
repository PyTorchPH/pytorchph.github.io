//! Whether a program code belongs to the given school level (checked when a profile is saved).
use crate::{ApiResult, internal};
use sqlx::{Sqlite, Transaction};

pub(crate) async fn program_fits_level(
    tx: &mut Transaction<'_, Sqlite>,
    code: &str,
    level: &str,
) -> ApiResult<bool> {
    let found: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM programs WHERE code = ? AND level = ?")
            .bind(code)
            .bind(level)
            .fetch_optional(&mut **tx)
            .await
            .map_err(internal)?;
    Ok(found.is_some())
}
