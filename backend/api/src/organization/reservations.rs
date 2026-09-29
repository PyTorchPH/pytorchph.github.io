//! Positions reserved for an email before that person has an account.
//!
//! Module map (caller-first):
//!   claim_reserved_positions     runs on every sign-in; a no-op once nothing is reserved
//!   ├─ reserved_positions        the positions waiting for this member's email
//!   ├─ hold_position             member_positions row plus its mail-approval role
//!   ├─ promote_to_officer        a plain member who holds a position becomes an officer
//!   └─ release_reservations      reservations are single use
use crate::{ApiResult, identity::session::Viewer, internal};
use sqlx::{Sqlite, SqlitePool, Transaction};

// Mental model: the organization chart is initialized with emails; the first time one of those
// people signs in, the reserved positions become theirs and their role rises to officer.
pub(crate) async fn claim_reserved_positions(db: &SqlitePool, viewer: Viewer) -> ApiResult<Viewer> {
    let positions = reserved_positions(db, &viewer.id).await?;
    if positions.is_empty() {
        return Ok(viewer);
    }
    let mut tx = db.begin().await.map_err(internal)?;
    for position in &positions {
        hold_position(&mut tx, &viewer.id, position).await?;
    }
    let role = promote_to_officer(&mut tx, &viewer.id, &viewer.role).await?;
    release_reservations(&mut tx, &viewer.id).await?;
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "organization",
        operation = "claim_reserved_positions",
        positions = positions.len(),
        "organization.positions_claimed"
    );
    Ok(Viewer { role, ..viewer })
}

async fn reserved_positions(db: &SqlitePool, member_id: &str) -> ApiResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT r.position_slug FROM position_reservations r JOIN members m ON r.email = lower(m.email) WHERE m.id = ?",
    )
    .bind(member_id)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    Ok(rows.into_iter().map(|(slug,)| slug).collect())
}

async fn hold_position(
    tx: &mut Transaction<'_, Sqlite>,
    member_id: &str,
    position: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT OR IGNORE INTO member_positions(member_id, position_slug, assigned_at) VALUES (?, ?, ?)")
        .bind(member_id)
        .bind(position)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    sqlx::query("INSERT OR IGNORE INTO officer_roles(member_id, role) SELECT ?, role FROM position_approval_roles WHERE position_slug = ?")
        .bind(member_id)
        .bind(position)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}

async fn promote_to_officer(
    tx: &mut Transaction<'_, Sqlite>,
    member_id: &str,
    role: &str,
) -> ApiResult<String> {
    if !is_plain_member(role) {
        return Ok(role.to_owned());
    }
    sqlx::query("UPDATE members SET role = 'officer' WHERE id = ?")
        .bind(member_id)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok("officer".to_owned())
}

async fn release_reservations(tx: &mut Transaction<'_, Sqlite>, member_id: &str) -> ApiResult<()> {
    sqlx::query("DELETE FROM position_reservations WHERE email = (SELECT lower(email) FROM members WHERE id = ?)")
        .bind(member_id)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}

#[inline]
fn is_plain_member(role: &str) -> bool {
    role == "member"
}
