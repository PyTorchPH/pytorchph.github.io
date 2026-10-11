//! Quarterly snapshots stay stable across hourly retries and exclude later evidence.
use super::*;
use chrono::{TimeZone, Utc};

#[test]
fn quarter_snapshot_rolls_back_at_year_and_quarter_boundaries() {
    for (year, month, expected, cutoff) in [
        (2026, 1, "2025-q4", "2025-12-31T23:59:59.999999999+00:00"),
        (2026, 4, "2026-q1", "2026-03-31T23:59:59.999999999+00:00"),
        (2026, 7, "2026-q2", "2026-06-30T23:59:59.999999999+00:00"),
        (2026, 10, "2026-q3", "2026-09-30T23:59:59.999999999+00:00"),
    ] {
        let date = Utc.with_ymd_and_hms(year, month, 1, 0, 0, 0).unwrap();
        assert_eq!(
            crate::scoring::scheduler::completed_quarter_at(date),
            (expected.into(), cutoff.into())
        );
    }
}

#[tokio::test]
async fn quarterly_pairs_are_unique_across_hours_and_new_again_next_season() {
    let (state, headers, officer, member) = fixture().await;
    let mut candidates = vec![member];
    for role in ["member", "officer", "officer"] {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,?,?)")
            .bind(&id).bind(&id).bind(format!("{id}@example.test")).bind("Quarter fixture")
            .bind(format!("fixture-{}", &id[..8])).bind(role).bind("2026-01-01T00:00:00Z")
            .execute(&state.db).await.unwrap();
        if role == "member" {
            candidates.push(id);
        }
    }
    let event = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO events(id,title,category,starts_at,competitive,entrant_kind,last_place,created_by,created_at) VALUES (?,'Quarter fixture','hackathon','2026-02-01T00:00:00Z',1,'individual',1,?,'2026-02-01T00:00:00Z')")
        .bind(&event).bind(&officer).execute(&state.db).await.unwrap();
    sqlx::query("INSERT INTO event_skill_tags(event_id,skill_slug,allocation_bps) VALUES (?,'pytorch',10000)")
        .bind(&event).execute(&state.db).await.unwrap();
    for id in &candidates {
        sqlx::query("INSERT INTO point_awards(id,member_id,source_type,event_id,base_points,reason,earned_at,created_at) VALUES (?,?,'event_result',?,50,'fixture','2026-02-01T00:00:00Z','2026-02-01T00:00:00Z')")
            .bind(Uuid::new_v4().to_string()).bind(id).bind(&event).execute(&state.db).await.unwrap();
    }
    for (bucket, season, cutoff, expected) in [
        ("before-evidence", "2025-q4", "2025-12-31T23:59:59Z", 0),
        ("first-hour", "2026-q1", "2026-03-31T23:59:59Z", 1),
        ("next-hour", "2026-q1", "2026-03-31T23:59:59Z", 1),
        ("next-quarter", "2026-q2", "2026-06-30T23:59:59Z", 2),
    ] {
        crate::scoring::scheduler::schedule_skill_snapshot(
            &state.db, "pytorch", bucket, season, cutoff,
        )
        .await
        .unwrap();
        let pairs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM skill_comparisons")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(pairs, expected, "unexpected pairs at {bucket}");
    }
    let Json(queue) = crate::scoring::comparison_queue(State(state.clone()), headers.clone())
        .await
        .unwrap();
    assert_eq!(
        queue.as_array().unwrap().len(),
        2,
        "assigned officers need no manual skill registration"
    );
    assert_ne!(queue[0]["a"]["label"], queue[0]["b"]["label"]);
    assert_ne!(
        queue[0]["a"]["label"], queue[1]["a"]["label"],
        "candidate labels rotate per season"
    );
    let Json(again) = crate::scoring::comparison_queue(State(state.clone()), headers)
        .await
        .unwrap();
    assert_eq!(queue, again, "labels remain stable within a season");
    let member_headers =
        member_session(&state, &HeaderMap::new(), &candidates[0], &"8".repeat(64)).await;
    assert!(matches!(
        crate::scoring::season_progress(State(state), member_headers).await,
        Err(ApiError(StatusCode::FORBIDDEN, _))
    ));
}
