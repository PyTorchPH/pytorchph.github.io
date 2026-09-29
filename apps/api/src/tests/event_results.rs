//! Official event results and entrant rules.
use super::*;

#[tokio::test]
async fn officer_result_is_authoritative_and_corrections_reverse_points() {
    let (state, headers, _, member) = fixture().await;
    let (_, Json(created)) = events::create_event(
        State(state.clone()),
        headers.clone(),
        Json(events::NewEvent {
            title: "Community Hackathon".into(),
            category: "hackathon".into(),
            starts_at: (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339(),
            parent_id: None,
            entrant_kind: Some("individual".into()),
            place_points: Some(vec![50, 30]),
        }),
    )
    .await
    .unwrap();
    let event_id = created.id;
    let (_, Json(entrant)) = events::add_entrant(
        State(state.clone()),
        headers.clone(),
        Path(event_id.clone()),
        Json(events::NewEntrant {
            name: "Entrant 1".into(),
            member_ids: vec![member.clone()],
        }),
    )
    .await
    .unwrap();
    let first = events::publish_results(
        State(state.clone()),
        headers.clone(),
        Path(event_id.clone()),
        Json(events::ResultInput {
            expected_revision: 0,
            placements: vec![events::Placement {
                place: 1,
                entrant_id: entrant.id.clone(),
            }],
            reason: "Official judges result".into(),
        }),
    )
    .await
    .unwrap();
    assert_eq!(first.0.revision, 1);
    let stale = events::publish_results(
        State(state.clone()),
        headers.clone(),
        Path(event_id.clone()),
        Json(events::ResultInput {
            expected_revision: 0,
            placements: vec![events::Placement {
                place: 1,
                entrant_id: entrant.id.clone(),
            }],
            reason: "Stale edit".into(),
        }),
    )
    .await
    .unwrap_err();
    assert_eq!(stale.0, StatusCode::PRECONDITION_FAILED);
    let correction = events::publish_results(
        State(state.clone()),
        headers,
        Path(event_id.clone()),
        Json(events::ResultInput {
            expected_revision: 1,
            placements: vec![events::Placement {
                place: 2,
                entrant_id: entrant.id,
            }],
            reason: "Judges corrected place".into(),
        }),
    )
    .await
    .unwrap();
    assert_eq!(correction.0.revision, 2);
    let ledger: Vec<(i64,)> =
        sqlx::query_as("SELECT delta FROM point_ledger WHERE event_id = ? ORDER BY rowid")
            .bind(&event_id)
            .fetch_all(&state.db)
            .await
            .unwrap();
    assert_eq!(
        ledger.into_iter().map(|row| row.0).collect::<Vec<_>>(),
        vec![50, -50, 30]
    );
    process_one_job(&state.db).await.unwrap();
    let points: i64 =
        sqlx::query_scalar("SELECT points FROM leaderboard_cache WHERE member_id = ?")
            .bind(member)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(points, 30);
}

#[tokio::test]
async fn unknown_member_and_unauthorized_user_cannot_enter_or_publish() {
    let (state, headers, _, _) = fixture().await;
    let (_, Json(created)) = events::create_event(
        State(state.clone()),
        headers.clone(),
        Json(events::NewEvent {
            title: "Workshop Challenge".into(),
            category: "workshop".into(),
            starts_at: (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339(),
            parent_id: None,
            entrant_kind: Some("team".into()),
            place_points: Some(vec![10]),
        }),
    )
    .await
    .unwrap();
    let invalid = events::add_entrant(
        State(state.clone()),
        headers.clone(),
        Path(created.id.clone()),
        Json(events::NewEntrant {
            name: "Invalid team".into(),
            member_ids: vec![Uuid::new_v4().to_string()],
        }),
    )
    .await
    .unwrap_err();
    assert_eq!(invalid.0, StatusCode::UNPROCESSABLE_ENTITY);
    let mut no_cookie = HeaderMap::new();
    no_cookie.insert("origin", "https://pytorch.ph".parse().unwrap());
    let denied = events::publish_results(
        State(state),
        no_cookie,
        Path(created.id),
        Json(events::ResultInput {
            expected_revision: 0,
            placements: vec![],
            reason: "No access".into(),
        }),
    )
    .await
    .unwrap_err();
    assert_eq!(denied.0, StatusCode::UNAUTHORIZED);
}
