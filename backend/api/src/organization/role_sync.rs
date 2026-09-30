//! Keeps a member's account role and mail approval roles in step with the positions they hold.
//!
//! Mental model: positions are the source of truth for officers. Holding any position makes a
//! member an officer and grants each held position's approval role; holding none returns an
//! officer to member. Admins keep their role either way.
use crate::{ApiResult, internal};
use sqlx::{Sqlite, Transaction};

pub(crate) async fn sync_member_role(
    tx: &mut Transaction<'_, Sqlite>,
    member_id: &str,
) -> ApiResult<()> {
    let (held,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM member_positions WHERE member_id = ?")
            .bind(member_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(internal)?;
    let role_change = if held > 0 {
        "UPDATE members SET role = 'officer' WHERE id = ? AND role = 'member'"
    } else {
        "UPDATE members SET role = 'member' WHERE id = ? AND role = 'officer'"
    };
    sqlx::query(role_change)
        .bind(member_id)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    // Approval roles follow the held positions exactly.
    sqlx::query("DELETE FROM officer_roles WHERE member_id = ? AND role NOT IN (SELECT a.role FROM member_positions m JOIN position_approval_roles a ON a.position_slug = m.position_slug WHERE m.member_id = ?)")
        .bind(member_id)
        .bind(member_id)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    sqlx::query("INSERT OR IGNORE INTO officer_roles(member_id, role) SELECT m.member_id, a.role FROM member_positions m JOIN position_approval_roles a ON a.position_slug = m.position_slug WHERE m.member_id = ?")
        .bind(member_id)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}
