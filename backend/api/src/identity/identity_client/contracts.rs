//! HTTP-level identity contracts: purpose/ownership headers, strict success statuses, empty 204.
use super::*;
use axum::{
    Json, Router,
    body::Bytes,
    extract::Path,
    http::HeaderMap,
    routing::{post, put},
};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

#[tokio::test]
async fn photo_mutations_accept_empty_204_and_send_only_owner_scoped_requests() {
    let member_id = Uuid::new_v4();
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let router = Router::new().route(
        "/v1/identities/{member_id}/organization-photo",
        put(
            move |Path(owner): Path<Uuid>, headers: HeaderMap, body: Bytes| {
                let counter = counter.clone();
                async move {
                    assert_owner(&headers, owner);
                    assert_eq!(headers["content-type"], "image/jpeg");
                    assert_eq!(body.as_ref(), b"synthetic-private-photo");
                    counter.fetch_add(1, Ordering::SeqCst);
                    StatusCode::NO_CONTENT
                }
            },
        )
        .delete(
            |Path(owner): Path<Uuid>, headers: HeaderMap, body: Bytes| async move {
                assert_owner(&headers, owner);
                assert!(body.is_empty());
                StatusCode::NO_CONTENT
            },
        ),
    );
    let (client, server) = mock_identity(router).await;
    client
        .write_organization_photo(member_id, b"synthetic-private-photo".to_vec(), "image/jpeg")
        .await
        .unwrap();
    client.delete_organization_photo(member_id).await.unwrap();
    client.delete_organization_photo(member_id).await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    server.abort();
}

#[tokio::test]
async fn unexpected_photo_statuses_never_report_mutation_success() {
    for status in [
        StatusCode::OK,
        StatusCode::UNAUTHORIZED,
        StatusCode::FORBIDDEN,
        StatusCode::PAYLOAD_TOO_LARGE,
        StatusCode::SERVICE_UNAVAILABLE,
    ] {
        let router =
            Router::new().fallback(move || async move { (status, "private-downstream-payload") });
        let (client, server) = mock_identity(router).await;
        let member_id = Uuid::new_v4();
        assert!(matches!(
            client
                .write_organization_photo(member_id, vec![1], "image/png")
                .await,
            Err(IdentityError::Unavailable)
        ));
        assert!(matches!(
            client.delete_organization_photo(member_id).await,
            Err(IdentityError::Unavailable)
        ));
        server.abort();
    }
}

#[tokio::test]
async fn verification_mail_requires_202_and_mailbox_requires_valid_organization_address() {
    let router = Router::new()
        .route(
            "/v1/identities/{member_id}/verification-mail",
            post(
                |Path(owner): Path<Uuid>,
                 headers: HeaderMap,
                 Json(body): Json<serde_json::Value>| async move {
                    assert_eq!(headers["x-viewer-id"], owner.to_string());
                    assert_eq!(headers["x-name-purpose"], "verification_mail");
                    assert_eq!(body["to"], "synthetic@example.test");
                    assert_eq!(body["code"], "12345678");
                    StatusCode::ACCEPTED
                },
            ),
        )
        .route(
            "/v1/identities/{member_id}/organization-mailbox",
            post(|Path(owner): Path<Uuid>, headers: HeaderMap| async move {
                assert_eq!(headers["x-viewer-id"], owner.to_string());
                assert_eq!(headers["x-name-purpose"], "mailbox_provisioning");
                Json(serde_json::json!({"address":"synthetic@pytorch.ph"}))
            }),
        );
    let (client, server) = mock_identity(router).await;
    let member_id = Uuid::new_v4();
    client
        .send_verification_mail(
            member_id,
            "synthetic@example.test",
            "12345678",
            "synthetic@pytorch.ph",
            "https://pytorch.ph/portal/register/#token=synthetic",
        )
        .await
        .unwrap();
    assert_eq!(
        client
            .provision_mailbox(member_id, "Synthetic Member")
            .await
            .unwrap()
            .address,
        "synthetic@pytorch.ph"
    );
    server.abort();

    let invalid = Router::new()
        .fallback(|| async { Json(serde_json::json!({"address":"synthetic@example.test"})) });
    let (client, server) = mock_identity(invalid).await;
    assert!(matches!(
        client
            .provision_mailbox(member_id, "Synthetic Member")
            .await,
        Err(IdentityError::Unavailable)
    ));
    assert!(matches!(
        client
            .send_verification_mail(
                member_id,
                "synthetic@example.test",
                "12345678",
                "synthetic@pytorch.ph",
                "https://pytorch.ph/"
            )
            .await,
        Err(IdentityError::Unavailable)
    ));
    server.abort();
}

fn assert_owner(headers: &HeaderMap, owner: Uuid) {
    assert_eq!(headers["x-viewer-id"], owner.to_string());
    assert_eq!(headers["x-name-purpose"], "organization_chart");
    assert!(Uuid::parse_str(headers["x-request-id"].to_str().unwrap()).is_ok());
    let timestamp: u64 = headers["x-request-timestamp"]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!(timestamp > 0);
}

async fn mock_identity(router: Router) -> (IdentityClient, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client =
        IdentityClient::test_loopback(&format!("http://{}/", listener.local_addr().unwrap()));
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (client, server)
}
