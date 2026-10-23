//! Real loopback requests exercise signup dependency and fallback contracts without live mail.
use super::*;
use crate::identity::identity_client::IdentityClient;
use axum::{Router, http::HeaderMap, routing::post};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

#[tokio::test]
async fn primary_acceptance_never_delivers_a_duplicate_through_the_relay() {
    let fixture = DeliveryFixture::new(StatusCode::OK, StatusCode::ACCEPTED, true).await;
    let response = fixture.start().await.unwrap();
    assert_eq!(response.0["message"], super::super::super::GENERIC_SENT);
    assert_eq!(fixture.primary_calls.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.relay_calls.load(Ordering::SeqCst), 0);
    fixture.assert_pending_without_member().await;
}

#[tokio::test]
async fn rejected_primary_uses_configured_relay_and_keeps_pending_verification() {
    let fixture = DeliveryFixture::new(StatusCode::OK, StatusCode::SERVICE_UNAVAILABLE, true).await;
    let response = fixture.start().await.unwrap();
    assert_eq!(response.0["message"], super::super::super::GENERIC_SENT);
    assert_eq!(fixture.primary_calls.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.relay_calls.load(Ordering::SeqCst), 1);
    fixture.assert_pending_without_member().await;
}

#[tokio::test]
async fn failed_mailbox_reservation_does_not_store_or_deliver_a_verification() {
    let fixture =
        DeliveryFixture::new(StatusCode::SERVICE_UNAVAILABLE, StatusCode::ACCEPTED, true).await;
    let error = fixture.start().await.unwrap_err();
    assert_eq!(error.0, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(fixture.primary_calls.load(Ordering::SeqCst), 0);
    assert_eq!(fixture.relay_calls.load(Ordering::SeqCst), 0);
    let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pending_email_signups")
        .fetch_one(&fixture.state.db)
        .await
        .unwrap();
    assert_eq!(pending, 0);
}

#[tokio::test]
async fn rejected_primary_without_relay_fails_closed_without_creating_an_account() {
    let mut fixture = DeliveryFixture::new(StatusCode::OK, StatusCode::FORBIDDEN, true).await;
    Arc::get_mut(&mut fixture.state).unwrap().mail_relay = None;
    let error = fixture.start().await.unwrap_err();
    assert_eq!(error.0, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error.1, verification_unavailable().1);
    assert_eq!(fixture.relay_calls.load(Ordering::SeqCst), 0);
    fixture.assert_pending_without_member().await;
}

#[tokio::test]
async fn rejected_primary_and_relay_never_claim_a_code_was_sent() {
    let fixture =
        DeliveryFixture::new(StatusCode::OK, StatusCode::SERVICE_UNAVAILABLE, false).await;
    let error = fixture.start().await.unwrap_err();
    assert_eq!(error.0, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error.1, verification_unavailable().1);
    assert_eq!(fixture.relay_calls.load(Ordering::SeqCst), 1);
    fixture.assert_pending_without_member().await;
}

#[tokio::test]
async fn configured_registration_keeps_existing_addresses_generic_without_sending_mail() {
    let fixture = DeliveryFixture::new(StatusCode::OK, StatusCode::ACCEPTED, true).await;
    let email: String = sqlx::query_scalar("SELECT email FROM members LIMIT 1")
        .fetch_one(&fixture.state.db)
        .await
        .unwrap();
    let result = fixture.start_for(&email).await.unwrap();
    assert_eq!(result.0["message"], super::super::super::GENERIC_SENT);
    assert_eq!(fixture.primary_calls.load(Ordering::SeqCst), 0);
    assert_eq!(fixture.relay_calls.load(Ordering::SeqCst), 0);
}

struct DeliveryFixture {
    state: Arc<AppState>,
    headers: HeaderMap,
    primary_calls: Arc<AtomicUsize>,
    relay_calls: Arc<AtomicUsize>,
    server: tokio::task::JoinHandle<()>,
}

impl DeliveryFixture {
    async fn new(
        mailbox_status: StatusCode,
        primary_status: StatusCode,
        relay_accepted: bool,
    ) -> Self {
        let (mut state, headers, _, _) = fixture().await;
        let primary_calls = Arc::new(AtomicUsize::new(0));
        let relay_calls = Arc::new(AtomicUsize::new(0));
        let primary_counter = primary_calls.clone();
        let relay_counter = relay_calls.clone();
        let app = Router::new()
            .route(
                "/v1/identities/{member_id}/organization-mailbox",
                post(move || async move {
                    (
                        mailbox_status,
                        Json(serde_json::json!({"address":"new_member@pytorch.ph"})),
                    )
                }),
            )
            .route(
                "/v1/identities/{member_id}/verification-mail",
                post(
                    move |headers: HeaderMap, Json(body): Json<serde_json::Value>| {
                        let counter = primary_counter.clone();
                        async move {
                            counter.fetch_add(1, Ordering::SeqCst);
                            assert_eq!(headers["x-name-purpose"], "verification_mail");
                            assert!(
                                Uuid::parse_str(headers["x-request-id"].to_str().unwrap()).is_ok()
                            );
                            assert_eq!(body["to"], "new-member@example.test");
                            assert_eq!(body["code"].as_str().unwrap().len(), 8);
                            assert_eq!(body["organizationEmail"], "new_member@pytorch.ph");
                            assert!(
                                body["verificationUrl"]
                                    .as_str()
                                    .unwrap()
                                    .starts_with("https://pytorch.ph/portal/register/#")
                            );
                            primary_status
                        }
                    },
                ),
            )
            .route(
                "/relay",
                post(
                    move |headers: HeaderMap, Json(body): Json<serde_json::Value>| {
                        let counter = relay_counter.clone();
                        async move {
                            counter.fetch_add(1, Ordering::SeqCst);
                            assert_eq!(headers["authorization"], "Bearer private-test-token");
                            assert_eq!(body["to"], "new-member@example.test");
                            Json(serde_json::json!({"accepted":relay_accepted}))
                        }
                    },
                ),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let app_state = Arc::get_mut(&mut state).unwrap();
        app_state.identity_client = Some(Arc::new(IdentityClient::test_loopback(&base)));
        app_state.mail_relay = Some(RelayConfig::test_loopback(&format!("{base}relay")));
        Self {
            state,
            headers,
            primary_calls,
            relay_calls,
            server,
        }
    }

    async fn start(&self) -> ApiResult<Json<serde_json::Value>> {
        self.start_for("new-member@example.test").await
    }

    async fn start_for(&self, email: &str) -> ApiResult<Json<serde_json::Value>> {
        let input = serde_json::from_value(serde_json::json!({
            "email":email, "password":"Fixture#Pass9", "name":"New Member", "username":"new_member"
        }))
        .unwrap();
        email_signup::start_signup(State(self.state.clone()), self.headers.clone(), Json(input))
            .await
    }

    async fn assert_pending_without_member(&self) {
        let members: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM members")
            .fetch_one(&self.state.db)
            .await
            .unwrap();
        let pending: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pending_email_signups WHERE email='new-member@example.test'",
        )
        .fetch_one(&self.state.db)
        .await
        .unwrap();
        assert_eq!(members, 2);
        assert_eq!(pending, 1);
    }
}

impl Drop for DeliveryFixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}
