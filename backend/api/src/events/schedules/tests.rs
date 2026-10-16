use super::*;
use crate::{ai_privacy::key::PrivacyKey, tests};
use axum::http::{HeaderMap, Method};
use std::sync::Arc;

async fn fixture() -> (Arc<AppState>, HeaderMap, String) {
    let (mut state, headers, officer, _) = tests::fixture().await;
    Arc::get_mut(&mut state).unwrap().ai_privacy_key =
        Some(PrivacyKey::parse(&"11".repeat(32), "k1").unwrap());
    sqlx::query("INSERT INTO member_positions(member_id,position_slug,assigned_at) VALUES (?,'head_learning_programs','2099-01-01')")
        .bind(&officer).execute(&state.db).await.unwrap();
    let (status, _) = tests::portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/member/ai-consent",
        json!({"purpose":"officer_assistant","granted":true}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    (state, headers, officer)
}

fn input() -> Value {
    json!({"id":"example-schedule","title":"Example learning session","startsAt":"2099-02","series":"Example series","modules":"Example module","confirm":true})
}

async fn create_call(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    body: Value,
) -> (StatusCode, Value) {
    tests::portal_call(
        state,
        headers,
        Method::POST,
        "/portal/api/officer/event-schedules",
        body,
    )
    .await
}

#[tokio::test]
async fn real_gateway_preserves_precision_and_retries_without_duplicate_or_overwrite() {
    let (state, headers, _) = fixture().await;
    let (status, created) = create_call(&state, &headers, input()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(created["created"], true);
    assert_eq!(created["event"]["startsAt"], "2099-02");
    assert_eq!(created["event"]["scheduleLabel"], "February 2099");
    assert_eq!(created["event"]["dateStatus"], "tentative");
    assert_eq!(
        create_call(&state, &headers, input()).await.1["created"],
        false
    );
    let mut changed = input();
    changed["title"] = json!("Different content");
    assert_eq!(
        create_call(&state, &headers, changed).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM featured_learning_events")
            .fetch_one(&state.db)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM audit_events WHERE operation='event.schedule_created'"
        )
        .fetch_one(&state.db)
        .await
        .unwrap(),
        1
    );
    let public = crate::site_content::programs::canonical_public(&state.db)
        .await
        .unwrap();
    assert_eq!(public[0]["modules"], "Example module");
    assert_eq!(public[0]["eventType"], "training");
    let mut exact = input();
    exact["id"] = json!("example-exact");
    exact["startsAt"] = json!("2099-02-28");
    let (_, exact) = create_call(&state, &headers, exact).await;
    assert_eq!(exact["event"]["scheduleLabel"], "February 28, 2099");
    assert_eq!(exact["event"]["dateStatus"], "confirmed");
}

#[tokio::test]
async fn consent_publication_grant_origin_role_and_confirmation_are_authoritative() {
    let (state, headers, officer) = fixture().await;
    let mut denied = headers.clone();
    denied.remove("cookie");
    assert_eq!(
        create_call(&state, &denied, input()).await.0,
        StatusCode::UNAUTHORIZED
    );
    denied = headers.clone();
    denied.insert("origin", "https://example.invalid".parse().unwrap());
    assert_eq!(
        create_call(&state, &denied, input()).await.0,
        StatusCode::FORBIDDEN
    );
    let mut bad_input = input();
    bad_input["confirm"] = json!(false);
    assert_eq!(
        create_call(&state, &headers, bad_input).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    for date in ["2099-02-30", "2099-13", "2099-2", "2099-02-01T00:00:00Z"] {
        let mut invalid = input();
        invalid["startsAt"] = json!(date);
        assert_eq!(
            create_call(&state, &headers, invalid).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let mut invalid = input();
    invalid["createdBy"] = json!("caller-controlled");
    assert_eq!(
        create_call(&state, &headers, invalid).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    sqlx::query("UPDATE ai_privacy_consents SET granted=0 WHERE member_id=?")
        .bind(&officer)
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        create_call(&state, &headers, input()).await.0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE ai_privacy_consents SET granted=1 WHERE member_id=?")
        .bind(&officer)
        .execute(&state.db)
        .await
        .unwrap();
    sqlx::query("DELETE FROM member_positions WHERE member_id=?")
        .bind(&officer)
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        create_call(&state, &headers, input()).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM featured_learning_events")
            .fetch_one(&state.db)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn projection_pages_only_public_fields_and_legacy_month_placeholders_remain_month_only() {
    let (state, headers, _) = fixture().await;
    for number in 0..21 {
        let mut value = input();
        value["id"] = json!(format!("example-{number:02}"));
        assert_eq!(create_call(&state, &headers, value).await.0, StatusCode::OK);
    }
    sqlx::query("UPDATE featured_learning_events SET starts_at='2099-02-01' WHERE id='example-00'")
        .execute(&state.db)
        .await
        .unwrap();
    let (status, projection) = tests::portal_call(
        &state,
        &headers,
        Method::POST,
        "/portal/api/officer/ai-projection",
        json!({"purpose":"officer_assistant","view":"event_schedules/"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        projection["projection"]["events"].as_array().unwrap().len(),
        20
    );
    assert_eq!(projection["projection"]["events"][0]["startsAt"], "2099-02");
    assert_eq!(projection["projection"]["nextCursor"], "example-19");
    let second = list(&state.db, "example-19").await.unwrap();
    assert_eq!(second["events"].as_array().unwrap().len(), 1);
    assert!(second["nextCursor"].is_null());
    let encoded = projection["projection"].to_string();
    for forbidden in ["created_by", "member_id", "email", "consent_revision"] {
        assert!(!encoded.contains(forbidden));
    }
    assert!(list(&state.db, "../private").await.is_err());
    assert_eq!(
        create_call(&state, &headers, input()).await.0,
        StatusCode::OK
    );
    sqlx::query("UPDATE featured_learning_events SET active=0 WHERE id='example-schedule'")
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        create_call(&state, &headers, input()).await.0,
        StatusCode::CONFLICT
    );
}
