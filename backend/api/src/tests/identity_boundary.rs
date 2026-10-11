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

#[tokio::test]
async fn organization_photo_never_falls_back_to_website_storage() {
    let (state, mut headers, _, member_id) = fixture().await;
    headers.insert("content-type", "image/png".parse().unwrap());
    for (path, method, body) in [
        (
            "member/organization-photo".to_owned(),
            Method::PUT,
            Bytes::from_static(b"not an image"),
        ),
        (
            "member/organization-photo-consent".to_owned(),
            Method::GET,
            Bytes::new(),
        ),
        (
            format!("officer/organization/photo/{member_id}"),
            Method::GET,
            Bytes::new(),
        ),
    ] {
        let result = portal::gateway(
            State(state.clone()),
            Path(path.clone()),
            OriginalUri(format!("/portal/api/{path}").parse().unwrap()),
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
