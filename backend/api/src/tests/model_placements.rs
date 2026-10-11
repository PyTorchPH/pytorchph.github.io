//! Published model proposals are immutable and copied into each event's award policy.
use super::*;

#[tokio::test]
async fn model_places_are_snapshotted_and_manual_changes_need_a_reason() {
    let (state, headers, officer, _) = fixture().await;
    sqlx::query("INSERT INTO scoring_model_versions(version,coefficients_json,validation_json,training_votes,published_by,published_at,details_md,place_points_json) VALUES (1,?,?,30,?,?,?,?)")
        .bind(r#"{"pytorch":{"hackathon":1500}}"#).bind("{}")
        .bind(&officer).bind(chrono::Utc::now().to_rfc3339())
        .bind("# Model v1\nValidated blind comparisons.")
        .bind(r#"{"hackathon":[100,60,30]}"#)
        .execute(&state.db).await.unwrap();
    let event = |points: Option<Vec<i64>>, reason: Option<&str>| events::NewEvent {
        title: "Model Hackathon".into(),
        category: "hackathon".into(),
        starts_at: (chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339(),
        parent_id: None,
        entrant_kind: Some("individual".into()),
        place_points: points,
        skill_tags: vec![events::EventSkillTag {
            skill_slug: "pytorch".into(),
            allocation_bps: 10000,
        }],
        weight_milli: None,
        weight_reason: reason.map(str::to_owned),
    };
    let (_, Json(created)) = events::create_event(
        State(state.clone()),
        headers.clone(),
        Json(event(None, None)),
    )
    .await
    .unwrap();
    let saved: (i64, String, String) = sqlx::query_as("SELECT model_version,proposed_place_points_json,selected_place_points_json FROM event_scoring WHERE event_id=?")
        .bind(&created.id).fetch_one(&state.db).await.unwrap();
    assert_eq!(saved, (1, "[100,60,30]".into(), "[100,60,30]".into()));
    let places: Vec<i64> =
        sqlx::query_scalar("SELECT points FROM place_points WHERE event_id=? ORDER BY place")
            .bind(&created.id)
            .fetch_all(&state.db)
            .await
            .unwrap();
    assert_eq!(places, vec![100, 60, 30]);

    assert!(
        events::create_event(
            State(state.clone()),
            headers.clone(),
            Json(event(Some(vec![120, 80, 40]), None))
        )
        .await
        .is_err()
    );
    let (_, Json(overridden)) = events::create_event(
        State(state.clone()),
        headers,
        Json(event(
            Some(vec![120, 80, 40]),
            Some("Judges approved a larger prize schedule"),
        )),
    )
    .await
    .unwrap();
    let reason: String =
        sqlx::query_scalar("SELECT placement_override_reason FROM event_scoring WHERE event_id=?")
            .bind(overridden.id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(reason, "Judges approved a larger prize schedule");
    assert!(
        sqlx::query("UPDATE scoring_model_versions SET details_md='changed' WHERE version=1")
            .execute(&state.db)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn noncompetitive_event_does_not_inherit_model_placement_schedule() {
    let (state, headers, officer, _) = fixture().await;
    sqlx::query("INSERT INTO scoring_model_versions(version,coefficients_json,validation_json,training_votes,published_by,published_at,details_md,place_points_json) VALUES (1,?,?,30,?,?,?,?)")
        .bind(r#"{"pytorch":{"workshop":1000}}"#).bind("{}")
        .bind(&officer).bind(chrono::Utc::now().to_rfc3339())
        .bind("# Workshop model")
        .bind(r#"{"workshop":[100,60,30]}"#)
        .execute(&state.db).await.unwrap();
    let (_, Json(created)) = events::create_event(
        State(state.clone()),
        headers,
        Json(events::NewEvent {
            title: "Learning workshop".into(),
            category: "workshop".into(),
            starts_at: (chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339(),
            parent_id: None,
            entrant_kind: None,
            place_points: None,
            skill_tags: vec![events::EventSkillTag {
                skill_slug: "pytorch".into(),
                allocation_bps: 10000,
            }],
            weight_milli: None,
            weight_reason: None,
        }),
    )
    .await
    .unwrap();
    let selected: Option<String> =
        sqlx::query_scalar("SELECT selected_place_points_json FROM event_scoring WHERE event_id=?")
            .bind(&created.id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    let places: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM place_points WHERE event_id=?")
        .bind(&created.id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(selected, None);
    assert_eq!(places, 0);
}
