//! Officer Command Center analytics.
use super::*;

#[tokio::test]
async fn officer_dashboard_analytics_are_live_and_members_keep_the_template() {
    let (state, officer, _, member_id) = fixture().await;
    let member = member_session(&state, &officer, &member_id, &"4".repeat(64)).await;
    sqlx::query("INSERT INTO evidence_claims(id,member_id,kind,title,source_url,content_hash,status,created_at) VALUES ('c-load',?,'external_competition','Contest','https://example.test/contest','hash-load','pending',?)")
        .bind(&member_id)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db)
        .await
        .unwrap();
    let (status, dashboard) = portal_call(
        &state,
        &officer,
        Method::GET,
        "/portal/api/product/dashboard",
        serde_json::json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let analytics = &dashboard["analytics"];
    assert_eq!(analytics["metrics"]["state"], "live");
    assert_eq!(
        analytics["metrics"]["data"][0]["value"], "2",
        "two approved members"
    );
    assert_eq!(
        analytics["metrics"]["data"][1]["value"], "2",
        "both have unexpired sessions or new evidence"
    );
    assert_eq!(analytics["activity"]["data"].as_array().unwrap().len(), 7);
    let relations = analytics["departments"]["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["department"] == "External relations")
        .unwrap()
        .clone();
    assert_eq!(
        relations["open"], 1,
        "competition evidence waits for external relations"
    );

    let (_, own) = portal_call(
        &state,
        &member,
        Method::GET,
        "/portal/api/product/dashboard",
        serde_json::json!(null),
    )
    .await;
    assert_ne!(
        own["analytics"]["metrics"]["state"], "live",
        "members do not get organization analytics"
    );
}
