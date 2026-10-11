//! Leaderboard achievements visibility.
use super::*;

#[tokio::test]
async fn tied_verified_points_have_matching_tiers_in_board_and_profile() {
    let (state, headers, _, member) = fixture().await;
    let other = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,'member',?)")
        .bind(&other).bind(&other).bind(format!("{other}@example.test")).bind("Tier fixture")
        .bind(format!("fixture-{}", &other[..8])).bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db).await.unwrap();
    for (id, owner) in [("tier-other", &other), ("tier-member", &member)] {
        claim(&state, id, owner, "manual").await;
        let (status, _) = portal_call(
            &state,
            &headers,
            Method::PATCH,
            &format!("/portal/api/officer/evidence/{id}"),
            serde_json::json!({"decision":"approve","level":"contributor","reason":""}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
    let (status, board) = portal_call(
        &state,
        &headers,
        Method::GET,
        "/portal/api/member/leaderboard",
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let entries: Vec<_> = board["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["verifiedPoints"].as_i64().unwrap() > 0)
        .collect();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0]["verifiedPoints"], entries[1]["verifiedPoints"]);
    assert_eq!(entries[0]["tier"], entries[1]["tier"]);
    assert_eq!(entries[0]["division"], entries[1]["division"]);
    let member_headers = member_session(&state, &headers, &member, &"7".repeat(64)).await;
    let (status, profile) = portal_call(
        &state,
        &member_headers,
        Method::GET,
        &format!("/portal/api/member/leaderboard/profile?id={member}"),
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(profile["standing"]["tier"], entries[0]["tier"]);
    assert_eq!(profile["standing"]["division"], entries[0]["division"]);
    assert_eq!(
        profile["standing"]["cohortPercentile"],
        entries[0]["cohortPercentile"]
    );
}

#[tokio::test]
async fn leaderboard_achievements_are_private_until_the_member_opts_in() {
    let (state, officer, _, member_id) = fixture().await;
    let token = "9".repeat(64);
    sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
        .bind(hex::encode(Sha256::digest(token.as_bytes())))
        .bind(&member_id)
        .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
        .execute(&state.db)
        .await
        .unwrap();
    let mut member = officer.clone();
    member.insert("cookie", format!("ph_session={token}").parse().unwrap());
    claim(&state, "c-shown", &member_id, "manual").await;
    portal_call(
        &state,
        &officer,
        Method::PATCH,
        "/portal/api/officer/evidence/c-shown",
        serde_json::json!({"decision":"approve","level":"contributor","reason":""}),
    )
    .await;
    let profile = format!("/portal/api/member/leaderboard/profile?id={member_id}");

    let (status, _) = portal_call(
        &state,
        &officer,
        Method::GET,
        &profile,
        serde_json::json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "implicit deny");
    let (_, board) = portal_call(
        &state,
        &officer,
        Method::GET,
        "/portal/api/member/leaderboard",
        serde_json::json!(null),
    )
    .await;
    let row = board["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["verifiedPoints"] == 60)
        .unwrap()
        .clone();
    assert!(row["profileId"].is_null(), "private rows are not linkable");
    let (status, own) = portal_call(
        &state,
        &member,
        Method::GET,
        &profile,
        serde_json::json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "members always see their own");
    assert_eq!(own["evidence"][0]["level"], "contributor");

    let settings = serde_json::json!({"hideGoogleIdentity":true,"hideRealName":true,"deviceCacheEnabled":false,"anonymousRanking":true,"automaticErrorReports":false,"shareAchievements":true});
    let (status, _) = portal_call(
        &state,
        &member,
        Method::PUT,
        "/portal/api/member/privacy",
        settings,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, shared) = portal_call(
        &state,
        &officer,
        Method::GET,
        &profile,
        serde_json::json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(shared["evidence"][0]["title"], "Talk");
    assert!(
        shared["evidence"][0]["sourceUrl"].is_null(),
        "anonymous members keep source links hidden"
    );
    assert!(
        shared["standing"]["displayLabel"]
            .as_str()
            .unwrap()
            .starts_with("Member ")
    );
}
