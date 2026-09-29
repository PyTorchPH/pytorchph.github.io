//! Synthetic sample members so a new portal shows a populated leaderboard. Enabled only
//! with SEED_SAMPLE_DATA=true; fixed ids make reruns idempotent. Every row hangs off a
//! member with is_sample = 1, so `DELETE FROM members WHERE is_sample = 1` removes all of
//! it through the cascading foreign keys. Remove the setting after that delete, or the
//! next start seeds the rows again.
use chrono::{Duration, Utc};
use sqlx::SqlitePool;

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

pub async fn seed(db: &SqlitePool) -> Result<(), sqlx::Error> {
    let now = Utc::now();
    let mut tx = db.begin().await?;
    for (index, (handle, name, skills)) in MEMBERS.iter().enumerate() {
        let id = format!("00000000-5a3e-4000-8000-{index:012}");
        sqlx::query("INSERT OR IGNORE INTO members(id,google_sub,email,display_name,public_handle,role,created_at,is_sample) VALUES (?,?,?,?,?,'member',?,1)")
            .bind(&id)
            .bind(format!("sample:{index}"))
            .bind(format!("sample-{index}@sample.pytorch.ph"))
            .bind(*name)
            .bind(*handle)
            .bind(now.to_rfc3339())
            .execute(&mut *tx)
            .await?;
        for skill in *skills {
            sqlx::query("INSERT OR IGNORE INTO member_skills(member_id,skill_slug,verified_at) VALUES (?,?,?)")
                .bind(&id)
                .bind(*skill)
                .bind(now.to_rfc3339())
                .execute(&mut *tx)
                .await?;
        }
        // Fewer, smaller awards further down the list give a spread of ranks and streaks.
        let awards = MEMBERS.len() - index;
        for week in 0..awards {
            let at = now - Duration::days(week as i64 * 7 + 1);
            let points = 30 + (awards as i64 - week as i64) * 20;
            sqlx::query("INSERT OR IGNORE INTO point_ledger(id,member_id,source_type,source_id,delta,reason,created_at) VALUES (?,?,'sample',?,?,'sample_activity',?)")
                .bind(format!("{id}-w{week}"))
                .bind(&id)
                .bind(format!("week-{week}"))
                .bind(points)
                .bind(at.to_rfc3339())
                .execute(&mut *tx)
                .await?;
        }
        if index % 2 == 0 {
            sqlx::query("INSERT OR IGNORE INTO evidence_claims(id,member_id,kind,title,source_url,content_hash,status,created_at) VALUES (?,?,'personal_project','Sample project write-up','https://pytorch.ph/',?,'pending',?)")
                .bind(format!("{id}-claim"))
                .bind(&id)
                .bind(format!("sample-{index}"))
                .bind(now.to_rfc3339())
                .execute(&mut *tx)
                .await?;
        }
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
