//! Records every event write shares: the created-resource reply, the audit trail and
//! point-ledger rows for placements.
//!
//! Module map:
//!   Created::first     reply for a newly created event or entrant (revision 0)
//!   audit              one audit row for an officer action
//!   LedgerEntry        one signed point change caused by an event result
//!   └─ insert          writes it to the point ledger
use crate::{ApiResult, internal, scoring};
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

/// One positive point award for a member caused by a placement.
pub(super) struct LedgerEntry<'a> {
    pub member_id: &'a str,
    pub event_id: &'a str,
    pub entrant_id: &'a str,
    pub place: i64,
    pub base_points: i64,
    pub revision: i64,
    pub actor_id: &'a str,
    pub reason: &'a str,
}

impl LedgerEntry<'_> {
    pub(super) async fn insert(&self, tx: &mut Tx<'_>) -> ApiResult<()> {
        let (weight, model_version) = scoring::event_weight(tx, self.event_id).await?;
        let earned_at = scoring::event_date(tx, self.event_id).await?;
        sqlx::query("INSERT INTO point_awards(id,member_id,source_type,event_id,entrant_id,place,base_points,weight_milli,model_version,result_revision,actor_id,reason,earned_at,created_at) VALUES (?,?,'event_result',?,?,?,?,?,?,?,?,?,?,?)")
            .bind(Uuid::new_v4().to_string()).bind(self.member_id).bind(self.event_id).bind(self.entrant_id)
        .bind(self.place).bind(self.base_points).bind(weight).bind(model_version).bind(self.revision).bind(self.actor_id).bind(self.reason)
        .bind(earned_at)
            .bind(Utc::now().to_rfc3339())
            .execute(&mut **tx).await.map_err(internal)?;
        Ok(())
    }
}
