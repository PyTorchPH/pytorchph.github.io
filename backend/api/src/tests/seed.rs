//! Sample members and the demo fixture snapshot.
use super::*;

#[tokio::test]
async fn sample_data_is_idempotent_ranked_and_removed_by_one_delete() {
    let (state, officer, _, _) = fixture().await;
    sample::seed(&state.db).await.unwrap();
    sample::seed(&state.db).await.unwrap();
    assert_eq!(
        count(
            &state.db,
            "SELECT COUNT(*) FROM members WHERE is_sample = 1"
        )
        .await,
        8
    );
    assert_eq!(
        count(&state.db, "SELECT COUNT(*) FROM point_ledger").await,
        36
    );
    let (_, board) = portal_call(
        &state,
        &officer,
        Method::GET,
        "/portal/api/member/leaderboard?season=",
        serde_json::json!(null),
    )
    .await;
    assert_eq!(board["entries"][0]["displayLabel"], "Ari_Sample");

    sqlx::query("DELETE FROM members WHERE is_sample = 1")
        .execute(&state.db)
        .await
        .unwrap();
    for table in ["point_ledger", "member_skills", "evidence_claims"] {
        assert_eq!(
            count(&state.db, &format!("SELECT COUNT(*) FROM {table}")).await,
            0,
            "{table}"
        );
    }
    assert_eq!(count(&state.db, "SELECT COUNT(*) FROM members").await, 2);
}

#[tokio::test]
async fn demo_snapshot_is_seeded_once_and_served_from_sqlite() {
    let (state, _, _, _) = fixture().await;
    demo::seed(&state.db).await.unwrap();
    let Json(snapshot) = demo::fixtures(State(state.clone())).await.unwrap();
    assert_eq!(
        snapshot["member"]["/api/capabilities"]["body"]["portal"]["audience"],
        "member"
    );
    assert_eq!(
        snapshot["officer"]["/api/capabilities"]["body"]["portal"]["audience"],
        "officer"
    );

    sqlx::query("UPDATE demo_fixtures SET payload_json = ? WHERE id = 1")
        .bind(
            r#"{"member":{"/api/demo":{"status":200,"body":{"source":"database"}}},"officer":{}}"#,
        )
        .execute(&state.db)
        .await
        .unwrap();
    demo::seed(&state.db).await.unwrap();
    let Json(updated) = demo::fixtures(State(state)).await.unwrap();
    assert_eq!(updated["member"]["/api/demo"]["body"]["source"], "database");
}
