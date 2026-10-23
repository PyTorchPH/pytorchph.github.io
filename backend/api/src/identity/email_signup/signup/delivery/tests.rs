use super::*;
use crate::{ApiError, identity::email_signup, tests::fixture};
use axum::{Json, extract::State, http::StatusCode};

mod service;

#[tokio::test]
async fn accepted_primary_does_not_poll_the_relay() {
    let result = deliver_with_fallback(async { Ok(()) }, async {
        panic!("The fallback must not send a duplicate verification email");
    })
    .await;
    assert_eq!(result, Ok(()));
}

#[tokio::test]
async fn failed_primary_uses_the_configured_relay() {
    let result = deliver_with_fallback(async { Err("identity_mail_failure") }, async {
        Some(Ok(()))
    })
    .await;
    assert_eq!(result, Ok(()));
}

#[tokio::test]
async fn absent_relay_preserves_the_primary_failure() {
    let result =
        deliver_with_fallback(async { Err("identity_mail_failure") }, async { None }).await;
    assert_eq!(result, Err("identity_mail_failure"));
}

#[tokio::test]
async fn rejected_relay_never_reports_a_sent_code() {
    let result = deliver_with_fallback(async { Err("identity_mail_failure") }, async {
        Some(Err("relay_not_accepted"))
    })
    .await;
    assert_eq!(result, Err("relay_not_accepted"));
}

#[tokio::test]
async fn missing_services_fail_equally_for_new_and_registered_addresses_without_creating_accounts()
{
    let (state, headers, _, member_id) = fixture().await;
    let registered: String = sqlx::query_scalar("SELECT email FROM members WHERE id=?")
        .bind(member_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    for email in ["new-member@example.test", registered.as_str()] {
        let input = serde_json::from_value(serde_json::json!({
            "email": email, "password": "Fixture#Pass9", "name": "New Member",
            "username": "new_member"
        }))
        .unwrap();
        let result =
            email_signup::start_signup(State(state.clone()), headers.clone(), Json(input)).await;
        let error = result.unwrap_err();
        assert_eq!(error.0, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(error.1, verification_unavailable().1);
    }
    let members: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM members")
        .fetch_one(&state.db)
        .await
        .unwrap();
    let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pending_email_signups")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(members, 2);
    assert_eq!(pending, 0);
}

#[tokio::test]
async fn offline_services_do_not_mask_invalid_registration_input() {
    let (state, headers, _, _) = fixture().await;
    let input = serde_json::from_value(serde_json::json!({
        "email": "invalid", "password": "Fixture#Pass9", "name": "New Member",
        "username": "new_member"
    }))
    .unwrap();
    let result = email_signup::start_signup(State(state), headers, Json(input)).await;
    assert!(matches!(
        result,
        Err(ApiError(StatusCode::BAD_REQUEST, "Invalid email address"))
    ));
}
