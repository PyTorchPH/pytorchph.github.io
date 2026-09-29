//! Schema migrations: cascading deletes keep every row they should.
use super::*;

#[tokio::test]
async fn cascade_migration_keeps_data_and_member_deletion_removes_only_their_rows() {
    let db = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let mut before = sqlx::migrate!();
    before.migrations = std::borrow::Cow::Owned(
        before
            .migrations
            .iter()
            .filter(|m| m.version < 5)
            .cloned()
            .collect(),
    );
    before.run(&db).await.unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    for (id, role) in [("off", "officer"), ("mem", "member"), ("oth", "member")] {
        sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,?,?)")
            .bind(id).bind(id).bind(format!("{id}@example.test")).bind(id).bind(id).bind(role).bind(&now)
            .execute(&db).await.unwrap();
    }
    for sql in [
        "INSERT INTO sessions VALUES ('t-mem','mem','2099-01-01')",
        "INSERT INTO events(id,title,category,starts_at,competitive,entrant_kind,last_place,created_by,created_at) VALUES ('ev','Hack','hackathon','2026-01-01',1,'individual',3,'off','2026-01-01')",
        "INSERT INTO place_points VALUES ('ev',1,50)",
        "INSERT INTO entrants VALUES ('en-mem','ev','Mem','individual')",
        "INSERT INTO entrants VALUES ('en-oth','ev','Oth','individual')",
        "INSERT INTO entrant_members VALUES ('en-mem','ev','mem')",
        "INSERT INTO entrant_members VALUES ('en-oth','ev','oth')",
        "INSERT INTO results VALUES ('ev',1,'en-mem',1)",
        "INSERT INTO point_ledger(id,member_id,event_id,entrant_id,place,delta,result_revision,actor_id,reason,created_at) VALUES ('pl-mem','mem','ev','en-mem',1,50,1,'off','result','2026-01-01')",
        "INSERT INTO point_ledger(id,member_id,source_type,source_id,delta,actor_id,reason,created_at) VALUES ('pl-oth','oth','attendance','ev',5,'off','attended','2026-01-01')",
        "INSERT INTO evidence_claims(id,member_id,kind,title,source_url,content_hash,status,reviewed_by,created_at) VALUES ('ec','mem','personal_project','P','https://x.test','h','approved','off','2026-01-01')",
        "INSERT INTO audit_events VALUES ('au-mem','mem','op','ev',NULL,'2026-01-01')",
        "INSERT INTO audit_events VALUES ('au-off','off','op','ev',NULL,'2026-01-01')",
        "INSERT INTO leaderboard_cache VALUES ('mem',50,'2026-01-01')",
        "INSERT INTO attendance_sources VALUES ('ev','form',5,'off','2026-01-01',NULL)",
        "INSERT INTO attendance_responses VALUES ('form','r1','ev','2026-01-01','oth@example.test','oth','awarded','off','2026-01-01')",
        "INSERT INTO officer_roles VALUES ('off','executive')",
        "INSERT INTO mail_routes VALUES ('general','[]','executive','off','2026-01-01')",
        "INSERT INTO mail_drafts VALUES ('md','general','off',1,'draft','2026-01-01','2026-01-01')",
        "INSERT INTO mail_revisions(draft_id,revision,recipients_json,subject,body,content_hash,required_roles_json,sender_role,edited_by,created_at) VALUES ('md',1,'[]','S','B','h','[]','executive','off','2026-01-01')",
        "INSERT INTO mail_approvals VALUES ('md',1,'executive','off','2026-01-01')",
        "INSERT INTO portal_state VALUES ('mem','/api/member/privacy','{}','2026-01-01')",
        "INSERT INTO portal_state VALUES ('__organization__','/api/feedback','[]','2026-01-01')",
    ] {
        sqlx::query(sql).execute(&db).await.unwrap();
    }
    let counts_before = table_counts(&db).await;

    sqlx::migrate!().run(&db).await.unwrap();
    let counts_after: Vec<(String, i64)> = table_counts(&db)
        .await
        .into_iter()
        .filter(|(name, _)| counts_before.iter().any(|(before, _)| before == name))
        .collect();
    assert_eq!(counts_after, counts_before, "rebuild must keep every row");
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM pragma_foreign_key_check").await,
        0
    );
    assert_eq!(
        count(&db, "SELECT foreign_keys FROM pragma_foreign_keys").await,
        1
    );

    // A departing officer takes their own rows, never other members' data.
    sqlx::query("DELETE FROM members WHERE id='off'")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM events WHERE id='ev' AND created_by IS NULL"
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM point_ledger WHERE actor_id IS NULL"
        )
        .await,
        2
    );
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM evidence_claims WHERE reviewed_by IS NULL"
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM attendance_responses WHERE imported_by IS NULL"
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM mail_drafts WHERE created_by IS NULL"
        )
        .await,
        1
    );
    assert_eq!(count(&db, "SELECT COUNT(*) FROM officer_roles").await, 0);
    assert_eq!(count(&db, "SELECT COUNT(*) FROM mail_approvals").await, 0);
    assert_eq!(count(&db, "SELECT COUNT(*) FROM audit_events").await, 1);

    // A departing member leaves no row behind that points at them.
    sqlx::query("DELETE FROM members WHERE id='mem'")
        .execute(&db)
        .await
        .unwrap();
    for sql in [
        "SELECT COUNT(*) FROM sessions WHERE member_id='mem'",
        "SELECT COUNT(*) FROM entrant_members WHERE member_id='mem'",
        "SELECT COUNT(*) FROM point_ledger WHERE member_id='mem'",
        "SELECT COUNT(*) FROM evidence_claims",
        "SELECT COUNT(*) FROM audit_events",
        "SELECT COUNT(*) FROM leaderboard_cache",
        "SELECT COUNT(*) FROM portal_state WHERE scope='mem'",
    ] {
        assert_eq!(count(&db, sql).await, 0, "{sql}");
    }
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM point_ledger WHERE member_id='oth'"
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM entrant_members WHERE member_id='oth'"
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM portal_state WHERE scope='__organization__'"
        )
        .await,
        1
    );

    // Deleting an event removes everything that belongs to it.
    sqlx::query("DELETE FROM events WHERE id='ev'")
        .execute(&db)
        .await
        .unwrap();
    for table in [
        "place_points",
        "entrants",
        "entrant_members",
        "results",
        "attendance_sources",
        "attendance_responses",
    ] {
        assert_eq!(
            count(&db, &format!("SELECT COUNT(*) FROM {table}")).await,
            0,
            "{table}"
        );
    }
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM point_ledger WHERE event_id IS NOT NULL"
        )
        .await,
        0
    );
}

#[tokio::test]
async fn pending_accounts_become_members_when_approval_is_dropped() {
    let db = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let mut before = sqlx::migrate!();
    before.migrations = std::borrow::Cow::Owned(
        before
            .migrations
            .iter()
            .filter(|m| m.version < 10)
            .cloned()
            .collect(),
    );
    before.run(&db).await.unwrap();
    sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES ('p1','g1','p1@example.test','P','P-1','pending','2026-01-01')")
        .execute(&db)
        .await
        .unwrap();
    sqlx::migrate!().run(&db).await.unwrap();
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM members WHERE role = 'pending'").await,
        0
    );
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM members WHERE id = 'p1' AND role = 'member'"
        )
        .await,
        1
    );
}

#[tokio::test]
async fn senior_high_years_become_grades_and_programs_move_to_their_own_table() {
    let db = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let mut before = sqlx::migrate!();
    before.migrations = std::borrow::Cow::Owned(
        before
            .migrations
            .iter()
            .filter(|m| m.version < 14)
            .cloned()
            .collect(),
    );
    before.run(&db).await.unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES ('m1','m1','m1@example.test','M','M-1','member',?)").bind(&now).execute(&db).await.unwrap();
    sqlx::query("INSERT INTO member_profiles(member_id,gender,region_code,status,channel,completed_at,updated_at) VALUES ('m1','female','04','student','friends',?,?)").bind(&now).bind(&now).execute(&db).await.unwrap();
    sqlx::query("INSERT INTO member_education(member_id,school_code,level,program,year_level) VALUES ('m1','unlisted','senior_high','ABM',2)").execute(&db).await.unwrap();
    sqlx::query(
        "INSERT INTO member_unlisted_schools(member_id,school_name) VALUES ('m1','Our Town High')",
    )
    .execute(&db)
    .await
    .unwrap();

    sqlx::migrate!().run(&db).await.unwrap();

    let (level, grade): (String, i64) =
        sqlx::query_as("SELECT level, year_level FROM member_education")
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!((level.as_str(), grade), ("senior_high", 12));
    // Migration 0016 then keeps earlier free-text programs as "unlisted" with their text.
    let (code, program): (String, String) = sqlx::query_as("SELECT p.program_code, u.program_name FROM member_education_programs p JOIN member_unlisted_programs u ON u.member_id = p.member_id")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!((code.as_str(), program.as_str()), ("unlisted", "ABM"));
    let (school,): (String,) = sqlx::query_as("SELECT school_name FROM member_unlisted_schools")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(school, "Our Town High");
}
