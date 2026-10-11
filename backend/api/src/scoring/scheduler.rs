//! Bounded, idempotent skill comparison pairing for approved evidence and officer validators.
use super::{evidence_revision, evidence_summary};
use chrono::Utc;
use serde_json::Value;
use sqlx::{Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

const MAX_SKILLS: i64 = 20;
const MAX_CANDIDATES: i64 = 40;
const MAX_PAIRS: usize = 10;
const MAX_NEW_PER_MEMBER: i64 = 2;
const VALIDATORS_PER_PAIR: usize = 3;

struct Candidate {
    id: String,
    evidence: String,
    scheduled: i64,
    added: i64,
}

/// An hourly run key and evidence hash make worker retries safe; random SQL order breaks
/// fairness ties, while completed and pending comparison counts keep new members in rotation.
pub(crate) async fn schedule_all(db: &SqlitePool) -> Result<(), sqlx::Error> {
    reassign_expired(db).await?;
    let skills: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT t.skill_slug FROM point_awards p JOIN event_skill_tags t ON t.event_id=p.event_id ORDER BY RANDOM() LIMIT ?",
    )
    .bind(MAX_SKILLS)
    .fetch_all(db)
    .await?;
    let bucket = Utc::now().format("%Y%m%d%H").to_string();
    for skill in skills {
        if let Err(error) = schedule_skill(db, &skill, &bucket).await {
            tracing::error!(component="scoring",operation="schedule_skill",skill=%skill,error_class="database",error=%error,"scoring.schedule_failed");
        }
    }
    Ok(())
}

pub(crate) async fn schedule_skill(
    db: &SqlitePool,
    skill: &str,
    bucket: &str,
) -> Result<(), sqlx::Error> {
    let run_key = format!("{bucket}:{skill}");
    let now = Utc::now();
    let attempt: Option<i64> = sqlx::query_scalar(
        "INSERT INTO comparison_schedule_runs(run_key,skill_slug,status,attempts,started_at,lease_expires_at) VALUES (?,?,'pending',1,?,?) \
         ON CONFLICT(run_key) DO UPDATE SET attempts=attempts+1,status='pending',started_at=excluded.started_at, \
         lease_expires_at=excluded.lease_expires_at,finished_at=NULL \
         WHERE comparison_schedule_runs.attempts<3 AND \
         (comparison_schedule_runs.status='failed' OR \
          (comparison_schedule_runs.status='pending' AND comparison_schedule_runs.lease_expires_at<excluded.started_at)) \
         RETURNING attempts",
    )
    .bind(&run_key)
    .bind(skill)
    .bind(now.to_rfc3339())
    .bind((now + chrono::Duration::minutes(10)).to_rfc3339())
    .fetch_optional(db)
    .await?;
    if attempt.is_none() {
        return Ok(());
    }
    let attempt = attempt.expect("claimed run has an attempt");
    match schedule_skill_once(db, skill, &run_key, attempt).await {
        Ok(created) => {
            tracing::info!(component="scoring",operation="schedule_skill",skill=%skill,run_key=%run_key,attempt,created,"scoring.schedule_done");
            Ok(())
        }
        Err(error) => {
            sqlx::query(
                "UPDATE comparison_schedule_runs SET status='failed',finished_at=? WHERE run_key=? AND attempts=? AND status='pending'",
            )
            .bind(Utc::now().to_rfc3339())
            .bind(&run_key)
            .bind(attempt)
            .execute(db)
            .await?;
            Err(error)
        }
    }
}

async fn schedule_skill_once(
    db: &SqlitePool,
    skill: &str,
    run_key: &str,
    attempt: i64,
) -> Result<usize, sqlx::Error> {
    let cutoff = Utc::now().to_rfc3339();
    let due_at = (Utc::now() + chrono::Duration::hours(72)).to_rfc3339();
    let mut candidates = eligible_candidates(db, skill, &cutoff).await?;
    if candidates.len() < 2 {
        finish_empty(db, run_key, attempt).await?;
        return Ok(0);
    }
    let mut tx = db.begin().await?;
    let mut created = 0;
    while created < MAX_PAIRS {
        candidates.sort_by_key(|candidate| candidate.scheduled + candidate.added);
        let mut inserted = false;
        'pairs: for a in 0..candidates.len() {
            if candidates[a].added >= MAX_NEW_PER_MEMBER {
                continue;
            }
            for b in (a + 1)..candidates.len() {
                if candidates[b].added >= MAX_NEW_PER_MEMBER {
                    continue;
                }
                let Some(validators) =
                    choose_validators(&mut tx, skill, &candidates[a].id, &candidates[b].id).await?
                else {
                    continue;
                };
                let (left, right) = if candidates[a].id < candidates[b].id {
                    (a, b)
                } else {
                    (b, a)
                };
                let revision =
                    evidence_revision(&candidates[left].evidence, &candidates[right].evidence);
                let comparison_id = Uuid::new_v4().to_string();
                let result = sqlx::query(
                    "INSERT INTO skill_comparisons(id,skill_slug,member_a,member_b,evidence_cutoff,evidence_a_json,evidence_b_json,created_at,evidence_revision,scheduler_run_key) \
                     VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                )
                .bind(&comparison_id).bind(skill).bind(&candidates[left].id).bind(&candidates[right].id)
                .bind(&cutoff).bind(&candidates[left].evidence).bind(&candidates[right].evidence)
                .bind(&cutoff).bind(revision).bind(run_key).execute(&mut *tx).await?;
                if result.rows_affected() == 0 {
                    continue;
                }
                for validator in validators {
                    sqlx::query("INSERT INTO comparison_validator_assignments(comparison_id,validator_id,assigned_at,due_at,flip) VALUES (?,?,?,?,CASE WHEN random()<0 THEN 1 ELSE 0 END)")
                        .bind(&comparison_id).bind(&validator).bind(&cutoff).bind(&due_at).execute(&mut *tx).await?;
                    assignment_audit(&mut tx, &comparison_id, &validator, "assigned").await?;
                }
                candidates[a].added += 1;
                candidates[b].added += 1;
                created += 1;
                inserted = true;
                break 'pairs;
            }
        }
        if !inserted {
            break;
        }
    }
    let finished = sqlx::query("UPDATE comparison_schedule_runs SET status='done',created_pairs=?,finished_at=? WHERE run_key=? AND attempts=? AND status='pending'")
        .bind(created as i64).bind(Utc::now().to_rfc3339()).bind(run_key).bind(attempt).execute(&mut *tx).await?;
    if finished.rows_affected() != 1 {
        return Err(sqlx::Error::Protocol(
            "Comparison schedule lease changed".into(),
        ));
    }
    tx.commit().await?;
    Ok(created)
}

async fn eligible_candidates(
    db: &SqlitePool,
    skill: &str,
    cutoff: &str,
) -> Result<Vec<Candidate>, sqlx::Error> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT m.id,(SELECT COUNT(*) FROM skill_comparisons c WHERE c.skill_slug=? AND (c.member_a=m.id OR c.member_b=m.id)) AS scheduled \
         FROM members m JOIN point_awards p ON p.member_id=m.id \
         JOIN event_skill_tags t ON t.event_id=p.event_id AND t.skill_slug=? \
         WHERE m.role!='pending' GROUP BY m.id ORDER BY scheduled,RANDOM() LIMIT ?",
    )
    .bind(skill)
    .bind(skill)
    .bind(MAX_CANDIDATES)
    .fetch_all(db)
    .await?;
    let mut candidates = Vec::new();
    for (id, scheduled) in rows {
        let evidence: Value = evidence_summary(db, &id, skill, cutoff).await?;
        if evidence["achievements"]
            .as_array()
            .is_none_or(Vec::is_empty)
        {
            continue;
        }
        candidates.push(Candidate {
            scheduled,
            id,
            evidence: evidence.to_string(),
            added: 0,
        });
    }
    Ok(candidates)
}

async fn choose_validators(
    tx: &mut Transaction<'_, Sqlite>,
    skill: &str,
    a: &str,
    b: &str,
) -> Result<Option<Vec<String>>, sqlx::Error> {
    let validators: Vec<String> = sqlx::query_scalar(
        "SELECT v.member_id FROM scoring_validators v JOIN members m ON m.id=v.member_id \
         WHERE v.skill_slug=? AND m.role IN ('officer','admin') AND v.member_id NOT IN (?,?) \
         ORDER BY (SELECT COUNT(*) FROM comparison_validator_assignments a \
                   WHERE a.validator_id=v.member_id AND a.status='pending' AND NOT EXISTS \
                   (SELECT 1 FROM skill_comparison_votes x WHERE x.comparison_id=a.comparison_id AND x.validator_id=a.validator_id)), RANDOM() LIMIT ?",
    ).bind(skill).bind(a).bind(b).bind(VALIDATORS_PER_PAIR as i64)
        .fetch_all(&mut **tx).await?;
    Ok((validators.len() == VALIDATORS_PER_PAIR).then_some(validators))
}

async fn finish_empty(db: &SqlitePool, run_key: &str, attempt: i64) -> Result<(), sqlx::Error> {
    let finished = sqlx::query("UPDATE comparison_schedule_runs SET status='done',finished_at=? WHERE run_key=? AND attempts=? AND status='pending'")
        .bind(Utc::now().to_rfc3339())
        .bind(run_key)
        .bind(attempt)
        .execute(db)
        .await?;
    if finished.rows_affected() != 1 {
        return Err(sqlx::Error::Protocol(
            "Comparison schedule lease changed".into(),
        ));
    }
    Ok(())
}

async fn reassign_expired(db: &SqlitePool) -> Result<(), sqlx::Error> {
    let expired: Vec<(String, String, String, String, String, i64)> = sqlx::query_as(
        "SELECT a.comparison_id,a.validator_id,c.skill_slug,c.member_a,c.member_b,a.attempt \
         FROM comparison_validator_assignments a JOIN skill_comparisons c ON c.id=a.comparison_id \
         WHERE a.status='pending' AND a.due_at<? ORDER BY a.due_at LIMIT 10",
    )
    .bind(Utc::now().to_rfc3339())
    .fetch_all(db)
    .await?;
    for (comparison, prior, skill, member_a, member_b, attempt) in expired {
        let mut tx = db.begin().await?;
        let updated = sqlx::query("UPDATE comparison_validator_assignments SET status='expired',finished_at=? WHERE comparison_id=? AND validator_id=? AND status='pending'")
            .bind(Utc::now().to_rfc3339()).bind(&comparison).bind(&prior).execute(&mut *tx).await?;
        if updated.rows_affected() == 0 {
            tx.commit().await?;
            continue;
        }
        assignment_audit(&mut tx, &comparison, &prior, "expired").await?;
        let mut replaced = false;
        if attempt < 3 {
            let replacement: Option<String> = sqlx::query_scalar(
                "SELECT v.member_id FROM scoring_validators v JOIN members m ON m.id=v.member_id \
                 WHERE v.skill_slug=? AND m.role IN ('officer','admin') AND v.member_id NOT IN (?,?) \
                 AND NOT EXISTS (SELECT 1 FROM comparison_validator_assignments a WHERE a.comparison_id=? AND a.validator_id=v.member_id) \
                 ORDER BY RANDOM() LIMIT 1",
            ).bind(&skill).bind(&member_a).bind(&member_b).bind(&comparison)
                .fetch_optional(&mut *tx).await?;
            if let Some(replacement) = replacement {
                let now = Utc::now();
                sqlx::query("INSERT INTO comparison_validator_assignments(comparison_id,validator_id,assigned_at,due_at,attempt,flip) VALUES (?,?,?,?,?,CASE WHEN random()<0 THEN 1 ELSE 0 END)")
                    .bind(&comparison).bind(&replacement).bind(now.to_rfc3339())
                    .bind((now + chrono::Duration::hours(72)).to_rfc3339()).bind(attempt + 1)
                    .execute(&mut *tx).await?;
                assignment_audit(&mut tx, &comparison, &replacement, "reassigned").await?;
                replaced = true;
            }
        }
        if !replaced {
            sqlx::query("UPDATE comparison_validator_assignments SET status='review_required' WHERE comparison_id=? AND validator_id=? AND status='expired'")
                .bind(&comparison).bind(&prior).execute(&mut *tx).await?;
            assignment_audit(&mut tx, &comparison, &prior, "review_required").await?;
            tracing::warn!(component="scoring",operation="reassign_expired",comparison_id=%comparison,attempt,"scoring.assignment_requires_review");
        }
        tx.commit().await?;
    }
    Ok(())
}

pub(super) async fn assignment_audit(
    tx: &mut Transaction<'_, Sqlite>,
    comparison_id: &str,
    validator_id: &str,
    action: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO comparison_assignment_audit(id,comparison_id,validator_id,action,at) VALUES (?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(comparison_id).bind(validator_id).bind(action)
        .bind(Utc::now().to_rfc3339()).execute(&mut **tx).await?;
    Ok(())
}
