//! The one delegation rule: a position is managed by whoever holds the position it reports to.
//!
//! Module map (caller-first):
//!   manages          does this member hold the parent of that position?
//!   ├─ parent_of     the position a position reports to (None for the head)
//!   └─ holds         does this member hold that position?
//!   seats_of         'one' or 'many' holders
use crate::{ApiResult, internal};
use sqlx::{Sqlite, Transaction};

type Tx<'a> = Transaction<'a, Sqlite>;

pub(crate) async fn manages(tx: &mut Tx<'_>, member_id: &str, position: &str) -> ApiResult<bool> {
    let Some(parent) = parent_of(tx, position).await? else {
        return Ok(false);
    };
    holds(tx, member_id, &parent).await
}

pub(crate) async fn parent_of(tx: &mut Tx<'_>, position: &str) -> ApiResult<Option<String>> {
    let parent: Option<(String,)> =
        sqlx::query_as("SELECT reports_to_slug FROM position_reports_to WHERE position_slug = ?")
            .bind(position)
            .fetch_optional(&mut **tx)
            .await
            .map_err(internal)?;
    Ok(parent.map(|(slug,)| slug))
}

pub(crate) async fn holds(tx: &mut Tx<'_>, member_id: &str, position: &str) -> ApiResult<bool> {
    let held: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM member_positions WHERE member_id = ? AND position_slug = ?")
            .bind(member_id)
            .bind(position)
            .fetch_optional(&mut **tx)
            .await
            .map_err(internal)?;
    Ok(held.is_some())
}

pub(crate) async fn seats_of(tx: &mut Tx<'_>, position: &str) -> ApiResult<Option<String>> {
    let seats: Option<(String,)> = sqlx::query_as("SELECT seats FROM positions WHERE slug = ?")
        .bind(position)
        .fetch_optional(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(seats.map(|(seats,)| seats))
}
