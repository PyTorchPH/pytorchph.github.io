//! Name consent never falls back to the website member PII columns.
use super::*;

#[tokio::test]
async fn leaderboard_photo_and_consent_fail_closed_without_identity_service() {
    let (state, headers, _, member_id) = fixture().await;
    for (method, path, input, expected) in [
        (
            Method::GET,
            format!("member/leaderboard-photo/{member_id}"),
            serde_json::Value::Null,
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            Method::GET,
            "member/leaderboard-photo-consent".into(),
            serde_json::Value::Null,
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            Method::PUT,
            "member/leaderboard-photo-consent".into(),
            serde_json::json!({"granted":true}),
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            Method::PUT,
            "member/leaderboard-photo-consent".into(),
            serde_json::json!({"granted":true,"memberId":member_id}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (status, _) = portal_call(
            &state,
            &headers,
            method,
            &format!("/portal/api/{path}"),
            input,
        )
        .await;
        assert_eq!(status, expected);
    }
    let stored: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM portal_state WHERE state_key LIKE '%photo%'")
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(
        stored, 0,
        "photo consent must never be stored in website fallback state"
    );
}

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
