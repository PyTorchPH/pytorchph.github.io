//! Reserved officer seats, the onboarding profile, and consent-only demographics.
use super::*;
use crate::{member_profile::catalog, organization::claim_reserved_positions};
use serde_json::{Value, json};

const TEST_SCHOOL: &str = "test-school";

fn first_code(list: &str) -> String {
    catalog::options()[list][0]["code"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn student_professional_profile(consent: bool) -> Value {
    json!({
        "gender": "prefer_not_to_say",
        "age": 20,
        "regionCode": first_code("regions"),
        "status": "student_professional",
        "channel": first_code("channels"),
        "interests": [first_code("interests")],
        "analyticsConsent": consent,
        "school": {"code": TEST_SCHOOL, "level": "undergraduate", "programCode": "test-bscs", "yearLevel": 3},
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
    sqlx::query("INSERT INTO member_profiles(member_id,gender,region_code,status,channel,completed_at,updated_at) VALUES (?,?,?,'seeking',?,?,?)")
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

#[tokio::test]
async fn exact_age_reads_back_and_prefer_not_to_say_stores_no_age() {
    let (state, officer_headers, _, member_id) = fixture().await;
    let headers = member_session(&state, &officer_headers, &member_id, &"f".repeat(64)).await;

    let (_, saved) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/member/profile",
        student_professional_profile(true),
    )
    .await;
    assert_eq!(saved["profile"]["age"], 20);

    let mut private = student_professional_profile(true);
    private.as_object_mut().unwrap().remove("age");
    private["agePreferNotToSay"] = json!(true);
    let (_, saved) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/member/profile",
        private,
    )
    .await;
    assert_eq!(saved["profile"]["agePreferNotToSay"], true);
    assert_eq!(
        count(&state.db, "SELECT COUNT(*) FROM member_ages").await,
        0
    );
}

#[tokio::test]
async fn every_age_is_accepted_but_zero_typos_and_missing_ages_are_rejected() {
    let (state, officer_headers, _, member_id) = fixture().await;
    let headers = member_session(&state, &officer_headers, &member_id, &"9".repeat(64)).await;
    for age in [json!(0), json!(121), json!("twenty"), Value::Null] {
        let mut input = student_professional_profile(true);
        input["age"] = age;
        let (status, _) = portal_call(
            &state,
            &headers,
            Method::PUT,
            "/portal/api/member/profile",
            input,
        )
        .await;
        assert_ne!(status, StatusCode::OK);
    }
}

#[tokio::test]
async fn demographics_report_age_ranges_from_current_age() {
    let (state, officer_headers, _, _) = fixture().await;
    for _ in 0..5 {
        consenting_profile(&state.db, "female").await;
    }
    sqlx::query("INSERT INTO member_ages(member_id, age, recorded_on) SELECT member_id, 17, date('now', '-2 years') FROM member_profiles")
        .execute(&state.db)
        .await
        .unwrap();

    let report = portal_get(&state, &officer_headers, "officer/demographics").await;

    let ages = report["breakdowns"]["ageRange"].as_array().unwrap();
    assert_eq!(ages.len(), 1);
    assert_eq!(ages[0]["count"], 5);
    assert_eq!(
        ages[0]["label"],
        catalog::option_label("ageRanges", "18_24").unwrap()
    );
}

#[tokio::test]
async fn school_search_matches_every_keyword_in_any_order_including_acronyms() {
    let (state, _, _, _) = fixture().await;
    crate::schools::load_school_directory(&state.db)
        .await
        .unwrap();
    let names = |rows: Vec<crate::schools::School>| {
        rows.into_iter()
            .map(|school| school.name)
            .collect::<Vec<_>>()
    };

    let reordered = names(
        crate::schools::search_schools(&state.db, "college HEART sacred", 20)
            .await
            .unwrap(),
    );
    assert!(
        reordered.iter().any(|name| name == "Sacred Heart College"),
        "{reordered:?}"
    );

    let by_acronym = names(
        crate::schools::search_schools(&state.db, "feu makati", 20)
            .await
            .unwrap(),
    );
    assert!(
        by_acronym
            .iter()
            .any(|name| name == "Far Eastern University-Makati"),
        "{by_acronym:?}"
    );

    let prefix = names(
        crate::schools::search_schools(&state.db, "sacr hea colle", 20)
            .await
            .unwrap(),
    );
    assert!(
        prefix.iter().any(|name| name == "Sacred Heart College"),
        "{prefix:?}"
    );

    assert!(
        crate::schools::search_schools(&state.db, "\" OR *", 20)
            .await
            .unwrap()
            .len()
            <= 20
    );
}

#[tokio::test]
async fn unknown_school_code_is_rejected_on_save() {
    let (state, officer_headers, _, member_id) = fixture().await;
    let headers = member_session(&state, &officer_headers, &member_id, &"8".repeat(64)).await;
    let mut input = student_professional_profile(true);
    input["school"]["code"] = json!("hei-does-not-exist");
    let (status, _) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/member/profile",
        input,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

fn studying_at(level: &str, year: i64, program: Option<&str>) -> Value {
    let mut input = student_professional_profile(true);
    input["status"] = json!("student");
    input.as_object_mut().unwrap().remove("employment");
    input["school"] = json!({"code": TEST_SCHOOL, "level": level, "yearLevel": year});
    if let Some(program) = program {
        input["school"]["programCode"] = json!(program);
    }
    input
}

#[tokio::test]
async fn each_school_level_accepts_only_its_grades_and_asks_for_a_program_only_when_it_has_one() {
    let (state, officer_headers, _, member_id) = fixture().await;
    let headers = member_session(&state, &officer_headers, &member_id, &"7".repeat(64)).await;
    let save = |input: Value| {
        portal_call(
            &state,
            &headers,
            Method::PUT,
            "/portal/api/member/profile",
            input,
        )
    };

    let (status, saved) = save(studying_at("elementary", 6, None)).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["profile"]["school"]["programCode"], Value::Null);
    assert_eq!(
        count(&state.db, "SELECT COUNT(*) FROM member_education_programs").await,
        0
    );

    let (status, saved) = save(studying_at("senior_high", 11, Some("test-stem"))).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(
        saved["profile"]["programLabel"],
        "Science, Technology, Engineering, and Mathematics"
    );

    for (level, year, program) in [
        ("elementary", 7, None),
        ("junior_high", 6, None),
        ("senior_high", 2, Some("STEM")),
        ("senior_high", 12, None),
        ("undergraduate", 9, Some("BSCS")),
    ] {
        let (status, _) = save(studying_at(level, year, program)).await;
        assert_ne!(
            status,
            StatusCode::OK,
            "{level} {year} {program:?} should be rejected"
        );
    }
}

#[tokio::test]
async fn unlisted_program_keeps_its_typed_name_apart_from_the_catalog() {
    let (state, officer_headers, _, member_id) = fixture().await;
    let headers = member_session(&state, &officer_headers, &member_id, &"6".repeat(64)).await;
    let mut input = studying_at("undergraduate", 2, Some("unlisted"));
    input["school"]["unlistedProgram"] = json!("BS Quantum Basketweaving");
    let (status, saved) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/member/profile",
        input,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["profile"]["programLabel"], "BS Quantum Basketweaving");
    assert_eq!(
        count(&state.db, "SELECT COUNT(*) FROM member_unlisted_programs").await,
        1
    );
}

#[tokio::test]
async fn program_and_company_directories_search_by_keywords_and_acronyms() {
    let (state, _, _, _) = fixture().await;
    crate::programs::load_program_catalog(&state.db)
        .await
        .unwrap();
    crate::companies::load_company_directory(&state.db)
        .await
        .unwrap();

    let names =
        |rows: Vec<crate::programs::Program>| rows.into_iter().map(|p| p.name).collect::<Vec<_>>();
    let bscs = names(
        crate::programs::programs_for_level(&state.db, "undergraduate", "bscs", 10)
            .await
            .unwrap(),
    );
    assert!(
        bscs.iter()
            .any(|name| name == "Bachelor of Science in Computer Science"),
        "{bscs:?}"
    );
    let reordered = names(
        crate::programs::programs_for_level(
            &state.db,
            "undergraduate",
            "computer bachelor science",
            50,
        )
        .await
        .unwrap(),
    );
    assert!(
        reordered
            .iter()
            .any(|name| name == "Bachelor of Science in Computer Science"),
        "{reordered:?}"
    );
    let strands = names(
        crate::programs::programs_for_level(&state.db, "senior_high", "", 50)
            .await
            .unwrap(),
    );
    assert!(
        strands.len() >= 10 && strands.iter().any(|name| name.starts_with("Humanities")),
        "{strands:?}"
    );
    assert!(
        crate::programs::programs_for_level(&state.db, "undergraduate", "", 50)
            .await
            .unwrap()
            .is_empty()
    );

    let companies = crate::companies::search_companies(&state.db, "pldt", 10)
        .await
        .unwrap();
    assert!(
        companies.iter().any(|company| company.name == "PLDT"),
        "{companies:?}"
    );
    let by_alias = crate::companies::search_companies(&state.db, "glo", 10)
        .await
        .unwrap();
    assert!(
        by_alias
            .iter()
            .any(|company| company.name == "Globe Telecom"),
        "{by_alias:?}"
    );
}

#[tokio::test]
async fn member_added_company_becomes_searchable_at_once_and_stays_unverified() {
    let (state, officer_headers, _, member_id) = fixture().await;
    let headers = member_session(&state, &officer_headers, &member_id, &"5".repeat(64)).await;
    let (status, _) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/member/profile",
        student_professional_profile(true),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let found = crate::companies::search_companies(&state.db, "acme robotics", 10)
        .await
        .unwrap();
    assert_eq!(found.len(), 1);
    assert!(!crate::companies::display::is_verified(&found[0]));
}

#[tokio::test]
async fn a_young_member_can_save_their_age() {
    let (state, officer_headers, _, member_id) = fixture().await;
    let headers = member_session(&state, &officer_headers, &member_id, &"4".repeat(64)).await;
    let mut input = studying_at("elementary", 3, None);
    input["age"] = json!(8);
    let (status, saved) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/member/profile",
        input,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["profile"]["age"], 8);
}

#[tokio::test]
async fn repeated_keywords_need_their_own_words_so_the_exact_program_wins() {
    let (state, _, _, _) = fixture().await;
    crate::programs::load_program_catalog(&state.db)
        .await
        .unwrap();
    for query in [
        "Bachelor of Science in Compute Science",
        "computer science science bachelor of in",
    ] {
        let found: Vec<String> =
            crate::programs::programs_for_level(&state.db, "undergraduate", query, 20)
                .await
                .unwrap()
                .into_iter()
                .map(|program| program.name)
                .collect();
        assert_eq!(
            found.first().map(String::as_str),
            Some("Bachelor of Science in Computer Science"),
            "{query}: {found:?}"
        );
        assert!(
            !found
                .iter()
                .any(|name| name == "Bachelor of Science in Computer Engineering"),
            "{query}: {found:?}"
        );
    }
}
