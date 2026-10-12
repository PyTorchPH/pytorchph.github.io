//! Canonical event publication and draft isolation.
use super::*;
use serde_json::{Value, json};

fn event_body(title: &str, publication: Value) -> Value {
    json!({"title":title,"category":"workshop","startsAt":"2027-02-01T08:00:00Z",
        "parentId":null,"entrantKind":null,"placePoints":null,
        "skillTags":[{"skillSlug":"pytorch","allocationBps":10000}],
        "weightMilli":1000,"weightReason":"Explicit organizer weight", "publication":publication})
}

#[tokio::test]
async fn saved_public_events_are_canonical_and_private_events_are_excluded() {
    let (state, headers, officer, _) = fixture().await;
    sqlx::query("INSERT INTO member_positions(member_id,position_slug,assigned_at) VALUES (?,'head_learning_programs','2026-10-13T00:00:00Z')")
        .bind(officer).execute(&state.db).await.unwrap();
    let (_, Json(private)) = events::create_public_event(
        State(state.clone()),
        headers.clone(),
        Json(event_body("Private planning event", json!({}))),
    )
    .await
    .unwrap();
    let (_, Json(public)) = events::create_public_event(
        State(state.clone()),
        headers.clone(),
        Json(event_body(
            "Demo workshop",
            json!({"isPublic":true,"isDemo":true,"topic":"Learning PyTorch","description":"Hands-on workshop\nBring your laptop.","venue":"Online"}),
        )),
    )
    .await
    .unwrap();
    let rows = crate::site_content::programs::canonical_public(&state.db)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], public.id);
    assert_eq!(rows[0]["isDemo"], true);
    assert_eq!(rows[0]["topic"], "Learning PyTorch");
    assert_eq!(
        rows[0]["description"],
        "Hands-on workshop\nBring your laptop."
    );
    assert_eq!(rows[0]["registrationUrl"], "");
    assert!(rows[0]["publishedAt"].is_null());
    assert!(!serde_json::to_string(&rows).unwrap().contains(&private.id));
    let hidden = events::update_publication(
        State(state.clone()),
        headers.clone(),
        Path(public.id.clone()),
        Json(json!({"isPublic":false,"isDemo":true})),
    )
    .await
    .unwrap();
    assert_eq!(hidden.0["ok"], true);
    assert!(
        crate::site_content::programs::canonical_public(&state.db)
            .await
            .unwrap()
            .is_empty()
    );
    let restored = events::update_publication(
        State(state.clone()),
        headers,
        Path(public.id.clone()),
        Json(json!({"isPublic":true,"isDemo":true,"topic":"Learning PyTorch","description":"Updated workshop content"})),
    )
    .await
    .unwrap();
    assert_eq!(restored.0["ok"], true);
    // Public projection reads the saved canonical title, not CMS or curriculum copies.
    sqlx::query("UPDATE events SET title='Updated saved workshop' WHERE id=?")
        .bind(&public.id)
        .execute(&state.db)
        .await
        .unwrap();
    let rows = crate::site_content::programs::canonical_public(&state.db)
        .await
        .unwrap();
    assert_eq!(rows[0]["title"], "Updated saved workshop");
    assert!(rows[0].get("createdBy").is_none());
    sqlx::query("DELETE FROM events WHERE id=?")
        .bind(&public.id)
        .execute(&state.db)
        .await
        .unwrap();
    assert!(
        crate::site_content::programs::canonical_public(&state.db)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        count(
            &state.db,
            "SELECT count(*) FROM event_publication WHERE is_public=1"
        )
        .await,
        0
    );
}

#[tokio::test]
async fn invalid_publication_cannot_create_an_event_or_a_real_demo_registration() {
    let (state, headers, officer, member) = fixture().await;
    sqlx::query("INSERT INTO member_positions(member_id,position_slug,assigned_at) VALUES (?,'head_learning_programs','2026-10-13T00:00:00Z')")
        .bind(officer).execute(&state.db).await.unwrap();
    for publication in [
        json!({"isPublic":true,"description":" "}),
        json!({"isPublic":true,"description":"x".repeat(2001)}),
        json!({"isPublic":true,"isDemo":true,"registrationUrl":"https://example.test/register"}),
        json!({"registrationUrl":"javascript:alert(1)"}),
        json!({"registrationUrl":"https://user:pass@example.test/"}),
        json!({"topic":"x".repeat(501)}),
        json!({"isPublic":true,"unknown":"client authority"}),
    ] {
        let error = events::create_public_event(
            State(state.clone()),
            headers.clone(),
            Json(event_body("Invalid publication", publication)),
        )
        .await
        .unwrap_err();
        assert_eq!(error.0, StatusCode::BAD_REQUEST);
    }
    assert_eq!(count(&state.db, "SELECT count(*) FROM events").await, 0);
    let member_headers = member_session(&state, &headers, &member, &"d".repeat(64)).await;
    let denied = events::create_public_event(
        State(state),
        member_headers,
        Json(event_body(
            "Unauthorized",
            json!({"isPublic":true,"description":"Valid public description"}),
        )),
    )
    .await
    .unwrap_err();
    assert_eq!(denied.0, StatusCode::FORBIDDEN);
}
