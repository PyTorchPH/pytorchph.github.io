//! Position delegation: only the holder of the position directly above may assign or remove.
use super::*;
use crate::organization::{assignments, chart};

async fn person(db: &sqlx::SqlitePool, name: &str, role: &str) -> session::Viewer {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(&id).bind(&id).bind(format!("{name}@example.test")).bind(name).bind(format!("{name}-{}", &id[..6]))
        .bind(role).bind(chrono::Utc::now().to_rfc3339())
        .execute(db).await.unwrap();
    session::Viewer {
        id,
        display_name: name.into(),
        role: role.into(),
    }
}

async fn seat(db: &sqlx::SqlitePool, who: &session::Viewer, position: &str) {
    sqlx::query("INSERT INTO member_positions(member_id, position_slug, assigned_at) VALUES (?, ?, '2026-09-30')")
        .bind(&who.id).bind(position).execute(db).await.unwrap();
}

async fn role_of(db: &sqlx::SqlitePool, who: &session::Viewer) -> String {
    sqlx::query_scalar("SELECT role FROM members WHERE id = ?")
        .bind(&who.id)
        .fetch_one(db)
        .await
        .unwrap()
}

fn status_of(result: crate::ApiResult<serde_json::Value>) -> StatusCode {
    match result {
        Ok(_) => StatusCode::OK,
        Err(ApiError(status, _)) => status,
    }
}

#[tokio::test]
async fn the_president_assigns_a_direct_report_who_becomes_an_officer_with_its_approval_role() {
    let (state, ..) = fixture().await;
    let president = person(&state.db, "president", "officer").await;
    seat(&state.db, &president, "president").await;
    let member = person(&state.db, "newcto", "member").await;

    assignments::assign_position(&state.db, &president, &member.id, "cto")
        .await
        .unwrap();

    assert_eq!(role_of(&state.db, &member).await, "officer");
    assert_eq!(
        count(
            &state.db,
            &format!(
                "SELECT COUNT(*) FROM officer_roles WHERE member_id='{}' AND role='executive'",
                member.id
            )
        )
        .await,
        1
    );
    assert_eq!(count(&state.db, "SELECT COUNT(*) FROM position_assignment_log WHERE action='assigned' AND position_slug='cto'").await, 1);
}

#[tokio::test]
async fn delegation_reaches_exactly_one_level_down() {
    let (state, ..) = fixture().await;
    let president = person(&state.db, "president", "officer").await;
    seat(&state.db, &president, "president").await;
    let cto = person(&state.db, "cto", "officer").await;
    seat(&state.db, &cto, "cto").await;
    let target = person(&state.db, "target", "member").await;

    // Two levels down, a sibling, and upward are all refused.
    assert_eq!(
        status_of(
            assignments::assign_position(&state.db, &president, &target.id, "engineering_lead")
                .await
        ),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        status_of(assignments::assign_position(&state.db, &cto, &target.id, "coo").await),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        status_of(assignments::assign_position(&state.db, &cto, &target.id, "president").await),
        StatusCode::FORBIDDEN
    );
    // The CTO fills its own direct report.
    assert_eq!(
        status_of(
            assignments::assign_position(&state.db, &cto, &target.id, "engineering_lead").await
        ),
        StatusCode::OK
    );
}

#[tokio::test]
async fn admins_follow_the_tree_too_and_nobody_assigns_themselves() {
    let (state, ..) = fixture().await;
    let admin = person(&state.db, "admin", "admin").await;
    let target = person(&state.db, "target", "member").await;
    assert_eq!(
        status_of(assignments::assign_position(&state.db, &admin, &target.id, "cto").await),
        StatusCode::FORBIDDEN
    );

    let head = person(&state.db, "head", "officer").await;
    seat(&state.db, &head, "head_partnerships_outreach").await;
    assert_eq!(
        status_of(
            assignments::assign_position(&state.db, &head, &head.id, "community_outreach_officer")
                .await
        ),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn single_seat_positions_take_one_holder_and_officer_positions_take_many() {
    let (state, ..) = fixture().await;
    let president = person(&state.db, "president", "officer").await;
    seat(&state.db, &president, "president").await;
    let first = person(&state.db, "first", "member").await;
    let second = person(&state.db, "second", "member").await;
    assignments::assign_position(&state.db, &president, &first.id, "cto")
        .await
        .unwrap();
    assert_eq!(
        status_of(assignments::assign_position(&state.db, &president, &second.id, "cto").await),
        StatusCode::CONFLICT
    );

    let head = person(&state.db, "head", "officer").await;
    seat(&state.db, &head, "head_partnerships_outreach").await;
    for who in [&first, &second] {
        assignments::assign_position(&state.db, &head, &who.id, "campus_lab_ambassador")
            .await
            .unwrap();
    }
    assert_eq!(
        count(
            &state.db,
            "SELECT COUNT(*) FROM member_positions WHERE position_slug='campus_lab_ambassador'"
        )
        .await,
        2
    );
}

#[tokio::test]
async fn only_the_parent_removes_and_a_member_with_no_position_returns_to_member() {
    let (state, ..) = fixture().await;
    let head = person(&state.db, "head", "officer").await;
    seat(&state.db, &head, "head_partnerships_outreach").await;
    let outsider = person(&state.db, "outsider", "officer").await;
    seat(&state.db, &outsider, "cmo").await;
    let officer = person(&state.db, "officer", "member").await;
    assignments::assign_position(&state.db, &head, &officer.id, "community_outreach_officer")
        .await
        .unwrap();

    assert_eq!(
        status_of(
            assignments::remove_holder(
                &state.db,
                &outsider,
                &officer.id,
                "community_outreach_officer"
            )
            .await
        ),
        StatusCode::FORBIDDEN
    );
    assignments::remove_holder(&state.db, &head, &officer.id, "community_outreach_officer")
        .await
        .unwrap();

    assert_eq!(role_of(&state.db, &officer).await, "member");
    assert_eq!(
        count(
            &state.db,
            "SELECT COUNT(*) FROM position_assignment_log WHERE action='removed'"
        )
        .await,
        1
    );
}

#[tokio::test]
async fn anyone_can_resign_their_own_position_and_loses_its_approval_role() {
    let (state, ..) = fixture().await;
    let treasurer = person(&state.db, "treasurer", "officer").await;
    seat(&state.db, &treasurer, "treasurer").await;
    sqlx::query("INSERT INTO officer_roles(member_id, role) VALUES (?, 'treasurer')")
        .bind(&treasurer.id)
        .execute(&state.db)
        .await
        .unwrap();

    assignments::resign_position(&state.db, &treasurer, "treasurer")
        .await
        .unwrap();

    assert_eq!(role_of(&state.db, &treasurer).await, "member");
    assert_eq!(
        count(
            &state.db,
            &format!(
                "SELECT COUNT(*) FROM officer_roles WHERE member_id='{}'",
                treasurer.id
            )
        )
        .await,
        0
    );
    assert_eq!(
        status_of(assignments::resign_position(&state.db, &treasurer, "treasurer").await),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn the_chart_marks_exactly_the_positions_the_viewer_may_change() {
    let (state, ..) = fixture().await;
    let cto = person(&state.db, "cto", "officer").await;
    seat(&state.db, &cto, "cto").await;

    let view = chart::org_chart(&state.db, &cto).await.unwrap();

    let manageable: Vec<&str> = view["positions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|position| position["canManage"] == true)
        .map(|position| position["slug"].as_str().unwrap())
        .collect();
    let mut sorted = manageable.clone();
    sorted.sort();
    assert_eq!(
        sorted,
        [
            "campus_labs_lead",
            "engineering_lead",
            "research_development_lead"
        ]
    );
}
