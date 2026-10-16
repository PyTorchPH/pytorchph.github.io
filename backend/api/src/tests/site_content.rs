//! Managed website publication through the real authenticated portal gateway.
use super::*;
use crate::site_content::{model, store};
use serde_json::json;

fn seed() -> serde_json::Value {
    serde_json::from_str(include_str!("fixtures/site-content.json")).unwrap()
}

#[test]
fn content_validation_rejects_script_urls_bad_dates_unknown_fields_and_oversized_values() {
    let baseline = seed();
    model::validate(&baseline).unwrap();
    for url in [
        "javascript:alert(1)",
        "data:text/html,x",
        "http://example.org/",
        "https://user:pass@example.org/",
    ] {
        let mut value = baseline.clone();
        value["events"][0]["registrationUrl"] = json!(url);
        assert!(model::validate(&value).is_err());
    }
    let mut value = baseline.clone();
    value["leadership"][0]["title"] = json!("a".repeat(8001));
    assert!(model::validate(&value).is_err());
    let mut value = baseline.clone();
    value["leadership"][0]["title"] = serde_json::Value::Null;
    assert!(model::validate(&value).is_err());
    let mut value = baseline.clone();
    value["unexpected"] = json!(true);
    assert!(model::validate(&value).is_err());
    let mut value = baseline.clone();
    value["events"] = json!([{"id":"one","title":"Real event","eventType":"training","topic":"PyTorch","startsAt":"invalid","dateStatus":"confirmed","scheduleLabel":"To be announced","venue":"Online","registrationUrl":"","series":"PyTorch Fundamentals","modules":"Introduction","photoUrl":""}]);
    assert!(model::validate(&value).is_err());
    value["events"][0]["startsAt"] = json!("");
    value["events"][0]["dateStatus"] = json!("coming_soon");
    model::validate(&value).unwrap();
    let duplicate = value["events"][0].clone();
    value["events"].as_array_mut().unwrap().push(duplicate);
    assert!(model::validate(&value).is_err());

    let mut legacy = baseline.clone();
    legacy["branding"] = json!({"tagline":"Static","description":"Static"});
    legacy["about"] = json!([]);
    legacy["contacts"] = json!({"facebook":"","linkedin":"","email":""});
    assert_eq!(model::dynamic_document(&legacy).unwrap(), baseline);
    assert!(model::validate(&legacy).is_err());
}

#[tokio::test]
async fn website_drafts_remain_private_until_distinct_current_presidents_approve() {
    let (state, headers, first, second) = fixture().await;
    let member_headers = member_session(&state, &headers, &second, &"b".repeat(64)).await;
    assert_eq!(
        portal_call(
            &state,
            &member_headers,
            Method::GET,
            "/portal/api/officer/site-content",
            json!({})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let mut unauthorized = headers.clone();
    unauthorized.remove("cookie");
    assert_eq!(
        portal_call(
            &state,
            &unauthorized,
            Method::GET,
            "/portal/api/officer/site-content",
            json!({})
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let mut document = seed();
    document["events"][0]["title"] = json!("Private draft marker <script>not executable</script>");
    let (status, draft) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/officer/site-content",
        json!({"revision":1,"document":document}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(draft["revision"], 2);
    let published = store::published(&state.db).await.unwrap();
    assert_eq!(published["revision"], 1);
    assert_ne!(
        published["document"]["events"][0]["title"],
        document["events"][0]["title"]
    );
    assert!(published.get("canApprove").is_none());
    assert!(published.get("approvals").is_none());
    assert_eq!(
        portal_call(
            &state,
            &headers,
            Method::PUT,
            "/portal/api/officer/site-content",
            json!({"revision":1,"document":document})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        portal_call(
            &state,
            &headers,
            Method::POST,
            "/portal/api/officer/site-content/approve",
            json!({"revision":2})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("INSERT INTO member_positions VALUES (?, 'president', 'now')")
        .bind(&first)
        .execute(&state.db)
        .await
        .unwrap();
    for _ in 0..2 {
        let (status, result) = portal_call(
            &state,
            &headers,
            Method::POST,
            "/portal/api/officer/site-content/approve",
            json!({"revision":2}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(result["approvals"], 1);
        assert_eq!(result["publishedRevision"], 1);
    }
    sqlx::query("INSERT INTO member_positions VALUES (?, 'president', 'now')")
        .bind(&second)
        .execute(&state.db)
        .await
        .unwrap();
    let mut tx = state.db.begin().await.unwrap();
    crate::organization::role_sync::sync_member_role(&mut tx, &second)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let (status, result) = portal_call(
        &state,
        &member_headers,
        Method::POST,
        "/portal/api/officer/site-content/approve",
        json!({"revision":2}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["publishedRevision"], 2);
    assert_eq!(
        store::published(&state.db).await.unwrap()["document"],
        document
    );
    document["events"][0]["title"] = json!("Next draft");
    assert_eq!(
        portal_call(
            &state,
            &headers,
            Method::PUT,
            "/portal/api/officer/site-content",
            json!({"revision":2,"document":document})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        portal_call(
            &state,
            &headers,
            Method::POST,
            "/portal/api/officer/site-content/approve",
            json!({"revision":2})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    sqlx::query("DELETE FROM member_positions WHERE member_id=? AND position_slug='president'")
        .bind(&second)
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        portal_call(
            &state,
            &member_headers,
            Method::POST,
            "/portal/api/officer/site-content/approve",
            json!({"revision":3})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(store::published(&state.db).await.unwrap()["revision"], 2);
    crate::organization::presidency::configure(&state.db, 1)
        .await
        .unwrap();
    assert_eq!(
        portal_call(
            &state,
            &headers,
            Method::POST,
            "/portal/api/officer/site-content/approve",
            json!({"revision":3})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(store::published(&state.db).await.unwrap()["revision"], 3);
    let mut bad_origin = headers.clone();
    bad_origin.insert("origin", "https://untrusted.example".parse().unwrap());
    assert_eq!(
        portal_call(
            &state,
            &bad_origin,
            Method::PUT,
            "/portal/api/officer/site-content",
            json!({"revision":3,"document":document})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}
