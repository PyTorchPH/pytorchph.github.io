//! Temporary member and officer accounts, seeded only when SEED_TEMP_TEST_ACCOUNTS=true.
//!
//! Module map (caller-first):
//!   seed_test_accounts     one member and one officer sharing TEMP_TEST_PASSWORD
//!   ├─ ensure_member       inserts the member once; keeps the officer an officer
//!   └─ ensure_credentials  password credentials that bypass email verification
use super::credentials::password_hash;
use chrono::Utc;
use sqlx::SqlitePool;
use uuid::Uuid;

type SeedResult = Result<(), Box<dyn std::error::Error>>;

const TEST_ACCOUNTS: [(&str, &str, &str); 2] = [
    ("member@admin.ph", "member", "TestMember"),
    ("officer@admin.ph", "officer", "TestOfficer"),
];

pub async fn seed_test_accounts(db: &SqlitePool, password: &str) -> SeedResult {
    for (email, role, handle) in TEST_ACCOUNTS {
        ensure_member(db, email, role, handle).await?;
        ensure_credentials(db, email, password).await?;
    }
    tracing::warn!(
        event = "auth.temporary_test_accounts_enabled",
        component = "auth",
        operation = "test_seed",
        outcome = "success",
        "Temporary test accounts seeded"
    );
    Ok(())
}

async fn ensure_member(db: &SqlitePool, email: &str, role: &str, handle: &str) -> SeedResult {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT OR IGNORE INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(&id).bind(format!("email:{id}")).bind(email).bind(handle).bind(handle).bind(role).bind(Utc::now().to_rfc3339())
        .execute(db).await?;
    if role == "officer" {
        sqlx::query("UPDATE members SET role='officer' WHERE email=?")
            .bind(email)
            .execute(db)
            .await?;
    }
    Ok(())
}

async fn ensure_credentials(db: &SqlitePool, email: &str, password: &str) -> SeedResult {
    let hash = password_hash(password).map_err(|_| "password hashing failed")?;
    sqlx::query("INSERT INTO email_credentials(member_id,password_hash,verified_at) SELECT id,?,? FROM members WHERE email=? ON CONFLICT(member_id) DO NOTHING")
        .bind(hash).bind(Utc::now().to_rfc3339()).bind(email).execute(db).await?;
    Ok(())
}
