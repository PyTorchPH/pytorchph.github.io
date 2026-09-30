//! Positions a member holds, and the checks built on them.
//!
//! Module map (caller-first):
//!   held_positions    the member's position slugs
//!   holds             one position?
//!   ensure_holders    every owner position in a draft has someone to review it
//!   sender_position   Communications Officer, or the CMO when that seat is empty
use super::{SENDER, SENDER_FALLBACK};
use crate::{ApiResult, bad, internal};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::HashSet;

pub(crate) async fn held_positions(db: &SqlitePool, member_id: &str) -> ApiResult<HashSet<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT position_slug FROM member_positions WHERE member_id = ?")
            .bind(member_id)
            .fetch_all(db)
            .await
            .map_err(internal)?;
    Ok(rows.into_iter().map(|(slug,)| slug).collect())
}

pub(crate) async fn holds(
    tx: &mut Transaction<'_, Sqlite>,
    member_id: &str,
    position: &str,
) -> ApiResult<bool> {
    crate::organization::tree::holds(tx, member_id, position).await
}

pub(crate) async fn ensure_holders(
    tx: &mut Transaction<'_, Sqlite>,
    positions: &HashSet<String>,
) -> ApiResult<()> {
    for position in positions {
        let (holders,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM member_positions WHERE position_slug = ?")
                .bind(position)
                .fetch_one(&mut **tx)
                .await
                .map_err(internal)?;
        if holders == 0 {
            return Err(bad(
                "Every part must be assigned to a position someone holds",
            ));
        }
    }
    Ok(())
}

pub(crate) async fn sender_position(tx: &mut Transaction<'_, Sqlite>) -> ApiResult<&'static str> {
    let (holders,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM member_positions WHERE position_slug = ?")
            .bind(SENDER)
            .fetch_one(&mut **tx)
            .await
            .map_err(internal)?;
    Ok(if holders > 0 { SENDER } else { SENDER_FALLBACK })
}
