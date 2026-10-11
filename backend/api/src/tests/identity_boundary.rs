//! Name consent never falls back to the website member PII columns.
use super::*;

#[tokio::test]
async fn organization_name_consent_requires_private_identity_service() {
    let (state, headers, _, _) = fixture().await;
    for (method, body) in [
        (Method::GET, Bytes::new()),
        (Method::PUT, Bytes::from_static(br#"{"granted":true}"#)),
    ] {
        let result = portal::gateway(
            State(state.clone()),
            Path("member/organization-name-consent".into()),
            OriginalUri(
                "/portal/api/member/organization-name-consent"
                    .parse()
                    .unwrap(),
            ),
            method,
            headers.clone(),
            body,
        )
        .await;
        assert!(matches!(
            result,
            Err(ApiError(StatusCode::SERVICE_UNAVAILABLE, _))
        ));
    }
}
