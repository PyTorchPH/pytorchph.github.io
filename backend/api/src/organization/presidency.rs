//! Presidential quorum: one validated startup setting, distinct current holders per revision.
use crate::{ApiResult, internal};
use sqlx::{Sqlite, SqlitePool, Transaction};

pub(crate) async fn configure(db: &SqlitePool, required: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE presidential_policy SET required_approvals = ? WHERE id = 1")
        .bind(required)
        .execute(db)
        .await?;
    tracing::info!(
        component = "organization",
        operation = "configure_presidency",
        required_approvals = required,
        "organization.presidential_policy_configured"
    );
    Ok(())
}

pub(crate) fn parse_required(value: Option<&str>) -> Result<i64, &'static str> {
    match value {
        None | Some("2") => Ok(2),
        Some("1") => Ok(1),
        _ => Err("PRESIDENT_REQUIRED_APPROVALS must be 1 or 2"),
    }
}

pub(crate) async fn required(db: &SqlitePool) -> ApiResult<i64> {
    sqlx::query_scalar("SELECT required_approvals FROM presidential_policy WHERE id = 1")
        .fetch_one(db)
        .await
        .map_err(internal)
}

pub(crate) async fn required_in(tx: &mut Transaction<'_, Sqlite>) -> ApiResult<i64> {
    sqlx::query_scalar("SELECT required_approvals FROM presidential_policy WHERE id = 1")
        .fetch_one(&mut **tx)
        .await
        .map_err(internal)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quorum_defaults_to_two_and_rejects_invalid_settings() {
        assert_eq!(parse_required(None), Ok(2));
        assert_eq!(parse_required(Some("1")), Ok(1));
        assert_eq!(parse_required(Some("2")), Ok(2));
        for value in ["", "0", "3", "true", " 1", "1 "] {
            assert!(parse_required(Some(value)).is_err());
        }
    }
}
