use super::*;
use std::io::{Read, Seek, SeekFrom};

#[test]
fn diagnostics_only_cover_approved_mutations() {
    for (method, endpoint, name) in [
        (Method::POST, "organization-mailbox", "mailbox_reservation"),
        (Method::POST, "verification-mail", "verification_delivery"),
        (Method::PUT, "organization-photo", "write_photo"),
        (Method::DELETE, "organization-photo", "remove_photo"),
    ] {
        assert_eq!(
            Operation::for_request(&method, endpoint).unwrap().name,
            name
        );
    }
    assert!(Operation::for_request(&Method::GET, "organization-photo").is_none());
    assert!(Operation::for_request(&Method::GET, "private-profile").is_none());
    assert!(Operation::for_request(&Method::DELETE, "organization-photo-data").is_none());
}

#[tokio::test]
async fn response_diagnostics_preserve_status_and_correlation_without_private_content() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = axum::Router::new()
        .fallback(|| async { (StatusCode::SERVICE_UNAVAILABLE, "private-response-payload") });
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let result = reqwest::get(format!(
        "http://{address}/private-member?token=private-token"
    ))
    .await;
    let request_id = Uuid::new_v4();
    let recorded = capture(|| {
        Operation::for_request(&Method::PUT, "organization-photo")
            .unwrap()
            .record(request_id, Duration::from_millis(12), &result);
    });
    server.abort();
    let event: serde_json::Value = serde_json::from_str(recorded.trim()).unwrap();
    assert_eq!(event["fields"]["status"], 503);
    assert_eq!(event["fields"]["request_id"], request_id.to_string());
    assert_eq!(event["fields"]["duration_ms"], 12);
    assert_eq!(event["fields"]["operation"], "write_photo");
    assert!(!recorded.contains("private-response-payload"));
    assert!(!recorded.contains("private-member"));
    assert!(!recorded.contains("private-token"));
    assert!(!recorded.contains(&address.to_string()));
}

#[tokio::test]
async fn transport_diagnostics_never_format_the_reqwest_error_or_url() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let result = reqwest::get(format!(
        "http://{address}/private-member?token=private-token"
    ))
    .await;
    assert!(result.is_err());
    let recorded = capture(|| {
        Operation::for_request(&Method::POST, "verification-mail")
            .unwrap()
            .record(Uuid::new_v4(), Duration::from_millis(1), &result);
    });
    let event: serde_json::Value = serde_json::from_str(recorded.trim()).unwrap();
    assert_eq!(event["fields"]["reason"], "connect_failed");
    assert!(!recorded.contains("private-member"));
    assert!(!recorded.contains("private-token"));
    assert!(!recorded.contains(&address.to_string()));
}

fn capture(record: impl FnOnce()) -> String {
    let file = tempfile::tempfile().unwrap();
    let mut reader = file.try_clone().unwrap();
    let subscriber = tracing_subscriber::fmt()
        .json()
        .without_time()
        .with_writer(file)
        .finish();
    tracing::subscriber::with_default(subscriber, record);
    reader.seek(SeekFrom::Start(0)).unwrap();
    let mut recorded = String::new();
    reader.read_to_string(&mut recorded).unwrap();
    recorded
}
