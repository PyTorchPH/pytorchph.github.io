//! Synthetic sample members so a new portal shows a populated leaderboard. Enabled only
//! with SEED_SAMPLE_DATA=true; fixed ids make reruns idempotent. Every row hangs off a
//! member with is_sample = 1, so `DELETE FROM members WHERE is_sample = 1` removes all of
//! it through the cascading foreign keys. Remove the setting after that delete, or the
//! next start seeds the rows again.
//!
//! Module map (caller-first):
//!   seed                    one transaction for every sample member
//!   └─ seed_member          the member, their skills, weekly points and maybe a pending claim
//!       ├─ insert_member
//!       ├─ verify_skills
//!       ├─ award_weekly_points
//!       │   ├─ awards_for      fewer awards further down the list
//!       │   ├─ award_time
//!       │   └─ weekly_points
//!       └─ submit_pending_claim (every other member)
//!   sample_member_id            fixed id per position
use chrono::{DateTime, Duration, Utc};
use sqlx::SqlitePool;

type Tx<'a> = sqlx::Transaction<'a, sqlx::Sqlite>;

const MEMBERS: [(&str, &str, &[&str]); 8] = [
    (
        "Ari_Sample",
        "Ari Santos",
        &["pytorch", "python", "research"],
    ),
    ("Bea_Sample", "Bea Reyes", &["python", "fastapi", "sql"]),
    (
        "Carlo_Sample",
        "Carlo Cruz",
        &["computer-vision", "pytorch"],
    ),
    ("Dani_Sample", "Dani Lim", &["nlp", "python"]),
    ("Eli_Sample", "Eli Garcia", &["react", "fastapi"]),
    ("Faye_Sample", "Faye Tan", &["data-engineering", "sql"]),
    ("Gio_Sample", "Gio Ramos", &["mentoring", "python"]),
    ("Hana_Sample", "Hana Uy", &["pytorch"]),
];

// Mental model: every sample member is written with INSERT OR IGNORE under a fixed id, so
// running the seed again changes nothing; earlier members get more, larger weekly awards.
pub async fn seed(db: &SqlitePool) -> Result<(), sqlx::Error> {
    let now = Utc::now();
    let mut tx = db.begin().await?;
    for (index, member) in MEMBERS.iter().enumerate() {
        seed_member(&mut tx, index, member, now).await?;
    }
    tx.commit().await?;
    tracing::info!(
        component = "sample",
        operation = "seed",
        members = MEMBERS.len(),
        "sample.seeded"
    );
    Ok(())
}

async fn seed_member(
    tx: &mut Tx<'_>,
    index: usize,
    (handle, name, skills): &(&str, &str, &[&str]),
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let id = sample_member_id(index);
    insert_member(tx, &id, index, handle, name, now).await?;
    verify_skills(tx, &id, skills, now).await?;
    award_weekly_points(tx, &id, awards_for(index), now).await?;
    if has_pending_claim(index) {
        submit_pending_claim(tx, &id, index, now).await?;
    }
    Ok(())
}

#[inline]
fn sample_member_id(index: usize) -> String {
    format!("00000000-5a3e-4000-8000-{index:012}")
}

async fn insert_member(
    tx: &mut Tx<'_>,
    id: &str,
    index: usize,
    handle: &str,
    name: &str,
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT OR IGNORE INTO members(id,google_sub,email,display_name,public_handle,role,created_at,is_sample) VALUES (?,?,?,?,?,'member',?,1)")
        .bind(id)
        .bind(format!("sample:{index}"))
        .bind(format!("sample-{index}@sample.pytorch.ph"))
        .bind(name)
        .bind(handle)
        .bind(now.to_rfc3339())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn verify_skills(
    tx: &mut Tx<'_>,
    id: &str,
    skills: &[&str],
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    for skill in skills {
        sqlx::query(
            "INSERT OR IGNORE INTO member_skills(member_id,skill_slug,verified_at) VALUES (?,?,?)",
        )
        .bind(id)
        .bind(*skill)
        .bind(now.to_rfc3339())
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

// One award per week going back from yesterday; the first weeks are worth the most.
async fn award_weekly_points(
    tx: &mut Tx<'_>,
    id: &str,
    awards: usize,
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    for week in 0..awards {
        sqlx::query("INSERT OR IGNORE INTO point_ledger(id,member_id,source_type,source_id,delta,reason,created_at) VALUES (?,?,'sample',?,?,'sample_activity',?)")
            .bind(format!("{id}-w{week}"))
            .bind(id)
            .bind(format!("week-{week}"))
            .bind(weekly_points(awards, week))
            .bind(award_time(now, week).to_rfc3339())
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

// Fewer, smaller awards further down the list give a spread of ranks and streaks.
#[inline]
fn awards_for(index: usize) -> usize {
    MEMBERS.len() - index
}

#[inline]
fn award_time(now: DateTime<Utc>, week: usize) -> DateTime<Utc> {
    now - Duration::days(week as i64 * 7 + 1)
}

#[inline]
fn weekly_points(awards: usize, week: usize) -> i64 {
    30 + (awards as i64 - week as i64) * 20
}

#[inline]
fn has_pending_claim(index: usize) -> bool {
    index % 2 == 0
}

async fn submit_pending_claim(
    tx: &mut Tx<'_>,
    id: &str,
    index: usize,
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT OR IGNORE INTO evidence_claims(id,member_id,kind,title,source_url,content_hash,status,created_at) VALUES (?,?,'personal_project','Sample project write-up','https://pytorch.ph/',?,'pending',?)")
        .bind(format!("{id}-claim"))
        .bind(id)
        .bind(format!("sample-{index}"))
        .bind(now.to_rfc3339())
        .execute(&mut **tx)
        .await?;
    Ok(())
}
