//! Bug-report attachments.
use super::*;

#[tokio::test]
async fn report_attachments_are_bounded_and_visible_to_reporter_and_officers() {
    let (state, officer, _, member_id) = fixture().await;
    let member = member_session(&state, &officer, &member_id, &"1".repeat(64)).await;
    let (status, created) = portal_call(&state, &member, Method::POST, "/portal/api/feedback", serde_json::json!({
        "category": "bug", "description": "Button does nothing", "route": "/career/evidence",
        "uiState": {"title": "Career Evidence", "online": true, "viewport": "1280x720", "componentMarkers": []}
    })).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let id = created["id"].as_str().unwrap().to_owned();
    let attach = format!("/portal/api/feedback/{id}/attachments");
    for (kind, data) in [
        (
            "logs",
            serde_json::json!([{"level": "error", "message": "TypeError: x is undefined", "at": "2026-09-29T00:00:00Z"}]),
        ),
        (
            "page_state",
            serde_json::json!("<main><h1>Career Evidence</h1></main>"),
        ),
        (
            "screenshot",
            serde_json::json!("data:image/jpeg;base64,/9j/4AAQSkZJRg=="),
        ),
    ] {
        let (status, body) = portal_call(
            &state,
            &member,
            Method::POST,
            &attach,
            serde_json::json!({"kind": kind, "data": data}),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{kind}: {body}");
    }
    let (status, _) = portal_call(&state, &member, Method::POST, &attach,
        serde_json::json!({"kind": "logs", "data": [{"level": "error", "message": "x", "at": "t", "extra": 1}]})).await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "log entries are strict"
    );
    let (status, _) = portal_call(
        &state,
        &officer,
        Method::POST,
        &attach,
        serde_json::json!({"kind": "logs", "data": []}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "only the reporter attaches");

    let (_, list) = portal_call(
        &state,
        &officer,
        Method::GET,
        "/portal/api/feedback?paginated=1",
        serde_json::json!(null),
    )
    .await;
    assert_eq!(
        list["items"][0]["attachments"],
        serde_json::json!(["logs", "page_state", "screenshot"])
    );
    let (status, items) = portal_call(
        &state,
        &officer,
        Method::GET,
        &attach,
        serde_json::json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        items[0]["content"][0]["message"],
        "TypeError: x is undefined"
    );
    assert!(
        items[2]["content"]
            .as_str()
            .unwrap()
            .starts_with("data:image/jpeg;base64,")
    );

    let other = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,'member',?)")
        .bind(&other).bind(&other).bind("other@example.test").bind("Other").bind("Other-1").bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db).await.unwrap();
    let outsider = member_session(&state, &officer, &other, &"2".repeat(64)).await;
    let (status, _) = portal_call(
        &state,
        &outsider,
        Method::GET,
        &attach,
        serde_json::json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    sqlx::query("DELETE FROM members WHERE id = ?")
        .bind(&member_id)
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        count(&state.db, "SELECT COUNT(*) FROM feedback_attachments").await,
        0
    );
}
