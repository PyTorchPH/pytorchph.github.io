//! The /portal/api gateway: private settings, officer elevation and owner-only media.
use super::*;

#[tokio::test]
async fn portal_gateway_persists_private_settings_and_rejects_cross_role_access() {
    let (state, officer_headers, _, member_id) = fixture().await;
    let settings = serde_json::json!({"hideGoogleIdentity":true,"hideRealName":false,"deviceCacheEnabled":true,"anonymousRanking":false,"automaticErrorReports":true});
    let put = portal::gateway(
        State(state.clone()),
        Path("member/privacy".to_owned()),
        OriginalUri("/portal/api/member/privacy".parse().unwrap()),
        Method::PUT,
        officer_headers.clone(),
        Bytes::from(settings.to_string()),
    )
    .await
    .unwrap();
    assert_eq!(put.status(), StatusCode::OK);
    let get = portal::gateway(
        State(state.clone()),
        Path("member/privacy".to_owned()),
        OriginalUri("/portal/api/member/privacy".parse().unwrap()),
        Method::GET,
        officer_headers.clone(),
        Bytes::new(),
    )
    .await
    .unwrap();
    let body = axum::body::to_bytes(get.into_body(), 65536).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        settings
    );

    let token = "b".repeat(64);
    sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
        .bind(hex::encode(Sha256::digest(token.as_bytes())))
        .bind(&member_id)
        .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
        .execute(&state.db)
        .await
        .unwrap();
    let mut member_headers = officer_headers.clone();
    member_headers.insert("cookie", format!("ph_session={token}").parse().unwrap());
    let member_get = portal::gateway(
        State(state.clone()),
        Path("member/privacy".to_owned()),
        OriginalUri("/portal/api/member/privacy".parse().unwrap()),
        Method::GET,
        member_headers.clone(),
        Bytes::new(),
    )
    .await
    .unwrap();
    let body = axum::body::to_bytes(member_get.into_body(), 65536)
        .await
        .unwrap();
    assert_ne!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        settings
    );
    let officer_only = portal::gateway(
        State(state),
        Path("officer/evidence".to_owned()),
        OriginalUri("/portal/api/officer/evidence".parse().unwrap()),
        Method::GET,
        member_headers,
        Bytes::new(),
    )
    .await;
    assert!(matches!(
        officer_only,
        Err(ApiError(StatusCode::FORBIDDEN, _))
    ));
}

#[tokio::test]
async fn officer_is_an_elevated_member_and_career_tools_are_open_to_members() {
    let (state, officer_headers, _, member_id) = fixture().await;
    let token = "c".repeat(64);
    sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
        .bind(hex::encode(Sha256::digest(token.as_bytes())))
        .bind(&member_id)
        .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
        .execute(&state.db)
        .await
        .unwrap();
    let mut member_headers = officer_headers.clone();
    member_headers.insert("cookie", format!("ph_session={token}").parse().unwrap());
    let seeds: serde_json::Value =
        serde_json::from_str(include_str!("../../seeds/demo-fixtures.json")).unwrap();

    let officer_dashboard = portal_get(&state, &officer_headers, "product/dashboard").await;
    assert_eq!(
        officer_dashboard["heading"],
        seeds["member"]["/api/product/dashboard"]["body"]["heading"]
    );

    let officer_caps = portal_get(&state, &officer_headers, "capabilities").await;
    let member_caps = portal_get(&state, &member_headers, "capabilities").await;
    assert_eq!(officer_caps["portal"]["audience"], "officer");
    assert_eq!(member_caps["portal"]["audience"], "member");
    assert_eq!(member_caps["capabilities"], officer_caps["capabilities"]);
    let locks = member_caps["capabilities"].to_string();
    assert!(!locks.contains("development owner session"), "{locks}");
}

#[tokio::test]
async fn portal_photo_is_readable_only_by_its_owner() {
    use base64::Engine as _;
    let (state, officer_headers, _, member_id) = fixture().await;
    let mut jpeg = vec![0xff, 0xd8, 0xff];
    jpeg.extend([0u8; 96]);
    jpeg.extend([0xff, 0xd9]);
    let payload = serde_json::json!({"title":"Synthetic photo","photoData":format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&jpeg))});
    let created = portal::gateway(
        State(state.clone()),
        Path("product/evidence".to_owned()),
        OriginalUri("/portal/api/product/evidence".parse().unwrap()),
        Method::POST,
        officer_headers.clone(),
        Bytes::from(payload.to_string()),
    )
    .await
    .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let body = axum::body::to_bytes(created.into_body(), 65536)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let media_id = value["item"]["mediaUrl"]
        .as_str()
        .unwrap()
        .split('/')
        .next_back()
        .unwrap()
        .to_owned();
    let owned = portal::media(
        State(state.clone()),
        Path(media_id.clone()),
        officer_headers.clone(),
    )
    .await
    .unwrap();
    assert_eq!(owned.status(), StatusCode::OK);

    let token = "d".repeat(64);
    sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
        .bind(hex::encode(Sha256::digest(token.as_bytes())))
        .bind(&member_id)
        .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
        .execute(&state.db)
        .await
        .unwrap();
    let mut other_headers = officer_headers;
    other_headers.insert("cookie", format!("ph_session={token}").parse().unwrap());
    let other = portal::media(State(state), Path(media_id), other_headers).await;
    assert!(matches!(other, Err(ApiError(StatusCode::NOT_FOUND, _))));
}
