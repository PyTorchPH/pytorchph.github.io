//! Reserved officer seats, the onboarding profile, and consent-only demographics.
use super::*;
use crate::{member_profile::catalog, organization::claim_reserved_positions};
use serde_json::{Value, json};

fn first_code(list: &str) -> String {
    catalog::options()[list][0]["code"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn student_professional_profile(consent: bool) -> Value {
    json!({
        "gender": "prefer_not_to_say",
        "ageRange": "18_24",
        "regionCode": first_code("regions"),
        "status": "student_professional",
        "channel": first_code("channels"),
        "interests": [first_code("interests")],
        "analyticsConsent": consent,
        "school": {"code": catalog::schools()[0].code, "level": "undergraduate", "program": "BS Computer Science", "yearLevel": 3},
        "employment": {"newCompanyName": "Acme Robotics PH", "industry": first_code("industries"), "jobRole": "ML intern", "experienceRange": "under_1"},
    })
}

async fn add_member(db: &sqlx::SqlitePool, email: &str, role: &str) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(&id).bind(&id).bind(email).bind("Test Member")
        .bind(format!("Member-{}", &id[..8])).bind(role).bind(chrono::Utc::now().to_rfc3339())
        .execute(db).await.unwrap();
    id
}

async fn consenting_profile(db: &sqlx::SqlitePool, gender: &str) {
    let id = add_member(db, &format!("{}@example.test", Uuid::new_v4()), "member").await;
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO member_profiles(member_id,gender,age_range,region_code,status,channel,completed_at,updated_at) VALUES (?,?,'18_24',?,'seeking',?,?,?)")
        .bind(&id).bind(gender).bind(first_code("regions")).bind(first_code("channels")).bind(&now).bind(&now)
        .execute(db).await.unwrap();
    sqlx::query("INSERT INTO member_analytics_consents(member_id,consented_at) VALUES (?,?)")
        .bind(&id)
        .bind(&now)
        .execute(db)
        .await
        .unwrap();
}

#[tokio::test]
async fn reserved_email_claims_its_officer_seat_on_first_sign_in() {
    let (state, _, _, _) = fixture().await;
    let id = add_member(&state.db, "JBalbarosa15@gmail.com", "member").await;
    let viewer = session::Viewer {
        id: id.clone(),
        display_name: "John".into(),
        role: "member".into(),
    };

    let claimed = claim_reserved_positions(&state.db, viewer).await.unwrap();

    assert_eq!(claimed.role, "officer");
    assert_eq!(count(&state.db, &format!("SELECT COUNT(*) FROM member_positions WHERE member_id='{id}' AND position_slug='cto'")).await, 1);
    assert_eq!(
        count(
            &state.db,
            "SELECT COUNT(*) FROM position_reservations WHERE email='jbalbarosa15@gmail.com'"
        )
        .await,
        0
    );
    let viewer = session::Viewer {
        id: id.clone(),
        display_name: "John".into(),
        role: claimed.role,
    };
    assert_eq!(
        claim_reserved_positions(&state.db, viewer)
            .await
            .unwrap()
            .role,
        "officer"
    );
}

#[tokio::test]
async fn unreserved_member_keeps_the_member_role() {
    let (state, _, _, member_id) = fixture().await;
    let viewer = session::Viewer {
        id: member_id,
        display_name: "Test".into(),
        role: "member".into(),
    };
    assert_eq!(
        claim_reserved_positions(&state.db, viewer)
            .await
            .unwrap()
            .role,
        "member"
    );
}

#[tokio::test]
async fn profile_round_trips_and_adds_a_new_company_once() {
    let (state, officer_headers, _, member_id) = fixture().await;
    let headers = member_session(&state, &officer_headers, &member_id, &"c".repeat(64)).await;

    let before = portal_get(&state, &headers, "member/profile").await;
    assert_eq!(before["complete"], false);

    let (status, saved) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/member/profile",
        student_professional_profile(true),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["complete"], true);
    assert_eq!(saved["profile"]["companyLabel"], "Acme Robotics PH");
    assert_eq!(saved["profile"]["school"]["yearLevel"], 3);

    let (status, _) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/member/profile",
        student_professional_profile(false),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        count(
            &state.db,
            "SELECT COUNT(*) FROM companies WHERE name = 'acme robotics ph' COLLATE NOCASE"
        )
        .await,
        1
    );
    assert_eq!(
        count(&state.db, "SELECT COUNT(*) FROM member_analytics_consents").await,
        0
    );
}

#[tokio::test]
async fn profile_rejects_a_student_without_a_school() {
    let (state, officer_headers, _, member_id) = fixture().await;
    let headers = member_session(&state, &officer_headers, &member_id, &"d".repeat(64)).await;
    let mut input = student_professional_profile(true);
    input.as_object_mut().unwrap().remove("school");

    let (status, _) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/member/profile",
        input,
    )
    .await;

    assert_ne!(status, StatusCode::OK);
    assert_eq!(
        count(&state.db, "SELECT COUNT(*) FROM member_profiles").await,
        0
    );
}

#[tokio::test]
async fn demographics_fold_groups_smaller_than_five_into_other() {
    let (state, officer_headers, _, member_id) = fixture().await;
    for _ in 0..5 {
        consenting_profile(&state.db, "female").await;
    }
    consenting_profile(&state.db, "male").await;

    let report = portal_get(&state, &officer_headers, "officer/demographics").await;

    assert_eq!(report["consented"], 6);
    assert_eq!(report["minimumGroupSize"], 5);
    let gender = report["breakdowns"]["gender"].as_array().unwrap();
    assert_eq!(gender.len(), 2);
    assert_eq!(gender[0]["count"], 5);
    assert_eq!(gender[1]["label"], "Other (fewer than 5)");
    let member_headers =
        member_session(&state, &officer_headers, &member_id, &"e".repeat(64)).await;
    let (status, _) = portal_call(
        &state,
        &member_headers,
        Method::GET,
        "/portal/api/officer/demographics",
        Value::Null,
    )
    .await;
    assert_ne!(status, StatusCode::OK);
}
