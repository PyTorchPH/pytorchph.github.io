//! Records every event write shares: the created-resource reply, the audit trail and
//! point-ledger rows for placements.
//!
//! Module map:
//!   Created::first     reply for a newly created event or entrant (revision 0)
//!   audit              one audit row for an officer action
//!   LedgerEntry        one signed point change caused by an event result
//!   └─ insert          writes it to the point ledger
use crate::{ApiResult, internal};
use chrono::Utc;
use serde::Serialize;
use uuid::Uuid;

pub(super) type Tx<'a> = sqlx::Transaction<'a, sqlx::Sqlite>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    pub id: String,
    pub revision: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
}

impl Created {
    #[inline]
    pub(super) fn first(id: String) -> Self {
        Self {
            id,
            revision: 0,
            job_id: None,
        }
    }
}

pub(super) async fn audit(
    tx: &mut Tx<'_>,
    actor_id: &str,
    operation: &str,
    entity_id: &str,
    revision: i64,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO audit_events(id,actor_id,operation,entity_id,revision,created_at) VALUES (?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(actor_id).bind(operation).bind(entity_id).bind(revision)
        .bind(Utc::now().to_rfc3339()).execute(&mut **tx).await.map_err(internal)?;
    Ok(())
}

/// One signed point change for a member caused by a placement in a given result revision.
pub(super) struct LedgerEntry<'a> {
    pub member_id: &'a str,
    pub event_id: &'a str,
    pub entrant_id: &'a str,
    pub place: i64,
    pub delta: i64,
    pub revision: i64,
    pub actor_id: &'a str,
    pub reason: &'a str,
}

impl LedgerEntry<'_> {
    pub(super) async fn insert(&self, tx: &mut Tx<'_>) -> ApiResult<()> {
        sqlx::query("INSERT INTO point_ledger(id,member_id,event_id,entrant_id,place,delta,result_revision,actor_id,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
            .bind(Uuid::new_v4().to_string()).bind(self.member_id).bind(self.event_id).bind(self.entrant_id)
            .bind(self.place).bind(self.delta).bind(self.revision).bind(self.actor_id).bind(self.reason)
            .bind(Utc::now().to_rfc3339())
            .execute(&mut **tx).await.map_err(internal)?;
        Ok(())
    }
}
