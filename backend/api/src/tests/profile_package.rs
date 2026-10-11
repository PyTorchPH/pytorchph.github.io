use super::*;

#[tokio::test]
async fn private_profile_routes_fail_closed_without_identity_service() {
    let (state, headers, _, _) = fixture().await;
    for path in [
        "member/profile-package",
        "member/consents",
        "member/self-photo",
    ] {
        let (status, _) = portal_call(
            &state,
            &headers,
            Method::GET,
            &format!("/portal/api/{path}"),
            serde_json::Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{path}");
    }
    let (status, _) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/member/private-profile",
        serde_json::json!({"phoneNumber":"+639123456789"}),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}
