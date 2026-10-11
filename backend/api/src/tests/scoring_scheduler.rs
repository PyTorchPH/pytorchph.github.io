//! Fixture-only checks for bounded, blind, idempotent comparison scheduling.
use super::*;

async fn add_member(db: &sqlx::SqlitePool, role: &str, label: &str) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(&id).bind(&id).bind(format!("{id}@example.test")).bind(label)
        .bind(format!("handle-{}", &id[..8])).bind(role).bind(chrono::Utc::now().to_rfc3339())
        .execute(db).await.unwrap();
    id
}

async fn add_evidence(db: &sqlx::SqlitePool, member_id: &str, owner: &str) {
    let event_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO events(id,title,category,starts_at,competitive,entrant_kind,last_place,created_by,created_at) VALUES (?,'Fixture event','hackathon',?,1,'individual',1,?,?)")
        .bind(&event_id).bind(&now).bind(owner).bind(&now).execute(db).await.unwrap();
    sqlx::query("INSERT INTO event_skill_tags(event_id,skill_slug,allocation_bps) VALUES (?,'pytorch',10000)")
        .bind(&event_id).execute(db).await.unwrap();
    sqlx::query("INSERT INTO point_awards(id,member_id,source_type,event_id,base_points,reason,earned_at,created_at) VALUES (?,?,'event_result',?,50,'fixture',?,?)")
        .bind(Uuid::new_v4().to_string()).bind(member_id).bind(&event_id).bind(&now).bind(&now)
        .execute(db).await.unwrap();
}

async fn add_validators(db: &sqlx::SqlitePool, officer: &str) {
    let second = add_member(db, "officer", "Validator Two").await;
    let third = add_member(db, "officer", "Validator Three").await;
    for id in [officer, &second, &third] {
        sqlx::query("INSERT INTO scoring_validators(member_id,skill_slug,assigned_at) VALUES (?,'pytorch',?)")
            .bind(id).bind(chrono::Utc::now().to_rfc3339()).execute(db).await.unwrap();
    }
}

#[tokio::test]
async fn scheduler_waits_for_two_evidenced_members_then_assigns_blind_officers_once() {
    let (state, headers, officer, member) = fixture().await;
    add_validators(&state.db, &officer).await;
    add_evidence(&state.db, &member, &officer).await;
    crate::scoring::scheduler::schedule_skill(&state.db, "pytorch", "fixture-sparse")
        .await
        .unwrap();
    let sparse: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM skill_comparisons")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(sparse, 0);

    let newcomer = add_member(&state.db, "member", "Hidden Newcomer").await;
    add_evidence(&state.db, &newcomer, &officer).await;
    crate::scoring::scheduler::schedule_skill(&state.db, "pytorch", "fixture-next-hour")
        .await
        .unwrap();
    crate::scoring::scheduler::schedule_skill(&state.db, "pytorch", "fixture-next-hour")
        .await
        .unwrap();
    let pairs: Vec<(String, String, String)> =
        sqlx::query_as("SELECT id,member_a,member_b FROM skill_comparisons")
            .fetch_all(&state.db)
            .await
            .unwrap();
    assert_eq!(pairs.len(), 1);
    assert_ne!(pairs[0].1, pairs[0].2);
    let assigned: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM comparison_validator_assignments WHERE comparison_id=?",
    )
    .bind(&pairs[0].0)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(assigned, 3);
    let Json(queue) = crate::scoring::comparison_queue(State(state.clone()), headers.clone())
        .await
        .unwrap();
    let payload = queue.to_string();
    assert_eq!(queue.as_array().unwrap().len(), 1);
    for private in [
        member.as_str(),
        newcomer.as_str(),
        "Hidden Newcomer",
        "@example.test",
    ] {
        assert!(!payload.contains(private), "private comparison data leaked");
    }
    sqlx::query("UPDATE comparison_validator_assignments SET flip=1 WHERE comparison_id=? AND validator_id=?")
        .bind(&pairs[0].0).bind(&officer).execute(&state.db).await.unwrap();
    let _ = crate::scoring::cast_vote(
        State(state.clone()),
        headers,
        Path(pairs[0].0.clone()),
        Json(crate::scoring::Vote {
            outcome: "a".into(),
        }),
    )
    .await
    .unwrap();
    let canonical: String = sqlx::query_scalar(
        "SELECT outcome FROM skill_comparison_votes WHERE comparison_id=? AND validator_id=?",
    )
    .bind(&pairs[0].0)
    .bind(&officer)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(canonical, "b");
    let replacement = add_member(&state.db, "officer", "Replacement Validator").await;
    sqlx::query(
        "INSERT INTO scoring_validators(member_id,skill_slug,assigned_at) VALUES (?,'pytorch',?)",
    )
    .bind(&replacement)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(&state.db)
    .await
    .unwrap();
    let waiting: String = sqlx::query_scalar("SELECT validator_id FROM comparison_validator_assignments WHERE comparison_id=? AND validator_id!=? LIMIT 1")
        .bind(&pairs[0].0).bind(&officer).fetch_one(&state.db).await.unwrap();
    sqlx::query("UPDATE comparison_validator_assignments SET due_at='2020-01-01T00:00:00Z' WHERE comparison_id=? AND validator_id=?")
        .bind(&pairs[0].0).bind(&waiting).execute(&state.db).await.unwrap();
    crate::scoring::scheduler::schedule_all(&state.db)
        .await
        .unwrap();
    let reassigned: (String, i64) = sqlx::query_as("SELECT status,attempt FROM comparison_validator_assignments WHERE comparison_id=? AND validator_id=?")
        .bind(&pairs[0].0).bind(&replacement).fetch_one(&state.db).await.unwrap();
    assert_eq!(reassigned, ("pending".into(), 2));
    let expired: String = sqlx::query_scalar("SELECT status FROM comparison_validator_assignments WHERE comparison_id=? AND validator_id=?")
        .bind(&pairs[0].0).bind(&waiting).fetch_one(&state.db).await.unwrap();
    assert_eq!(expired, "expired");
}

#[tokio::test]
async fn pending_schedule_requires_expired_lease_before_retry() {
    let (state, _, officer, member) = fixture().await;
    add_evidence(&state.db, &member, &officer).await;
    let now = chrono::Utc::now();
    sqlx::query("INSERT INTO comparison_schedule_runs(run_key,skill_slug,status,attempts,started_at,lease_expires_at) VALUES ('fixture-lease:pytorch','pytorch','pending',1,?,?)")
        .bind(now.to_rfc3339())
        .bind((now + chrono::Duration::minutes(10)).to_rfc3339())
        .execute(&state.db).await.unwrap();
    crate::scoring::scheduler::schedule_skill(&state.db, "pytorch", "fixture-lease")
        .await
        .unwrap();
    let active: (String, i64) = sqlx::query_as("SELECT status,attempts FROM comparison_schedule_runs WHERE run_key='fixture-lease:pytorch'")
        .fetch_one(&state.db).await.unwrap();
    assert_eq!(active, ("pending".into(), 1));

    sqlx::query("UPDATE comparison_schedule_runs SET lease_expires_at='2020-01-01T00:00:00Z' WHERE run_key='fixture-lease:pytorch'")
        .execute(&state.db).await.unwrap();
    crate::scoring::scheduler::schedule_skill(&state.db, "pytorch", "fixture-lease")
        .await
        .unwrap();
    let recovered: (String, i64) = sqlx::query_as("SELECT status,attempts FROM comparison_schedule_runs WHERE run_key='fixture-lease:pytorch'")
        .fetch_one(&state.db).await.unwrap();
    assert_eq!(recovered, ("done".into(), 2));
}

#[tokio::test]
async fn newcomer_is_considered_when_candidate_pool_exceeds_limit() {
    let (state, _, officer, member) = fixture().await;
    add_validators(&state.db, &officer).await;
    let mut established = vec![member];
    while established.len() < 40 {
        established.push(add_member(&state.db, "member", "Established member").await);
    }
    for id in &established {
        add_evidence(&state.db, id, &officer).await;
    }
    for pair in established.as_chunks::<2>().0 {
        let (a, b) = if pair[0] < pair[1] {
            (&pair[0], &pair[1])
        } else {
            (&pair[1], &pair[0])
        };
        sqlx::query("INSERT INTO skill_comparisons(id,skill_slug,member_a,member_b,evidence_cutoff,evidence_a_json,evidence_b_json,created_at) VALUES (?,'pytorch',?,?,'2020-01-01T00:00:00Z','{}','{}','2020-01-01T00:00:00Z')")
            .bind(Uuid::new_v4().to_string()).bind(a).bind(b)
            .execute(&state.db).await.unwrap();
    }
    let newcomer = add_member(&state.db, "member", "New member").await;
    add_evidence(&state.db, &newcomer, &officer).await;
    crate::scoring::scheduler::schedule_skill(&state.db, "pytorch", "fixture-fairness")
        .await
        .unwrap();
    let included: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM skill_comparisons WHERE scheduler_run_key='fixture-fairness:pytorch' AND (member_a=? OR member_b=?)")
        .bind(&newcomer).bind(&newcomer).fetch_one(&state.db).await.unwrap();
    assert!((1..=2).contains(&included));
}

#[tokio::test]
async fn exhausted_assignment_is_visible_only_to_admins() {
    let (state, headers, officer, member) = fixture().await;
    add_validators(&state.db, &officer).await;
    add_evidence(&state.db, &member, &officer).await;
    let other = add_member(&state.db, "member", "Other candidate").await;
    add_evidence(&state.db, &other, &officer).await;
    crate::scoring::scheduler::schedule_skill(&state.db, "pytorch", "fixture-review")
        .await
        .unwrap();
    let comparison: String = sqlx::query_scalar(
        "SELECT id FROM skill_comparisons WHERE scheduler_run_key='fixture-review:pytorch'",
    )
    .fetch_one(&state.db)
    .await
    .unwrap();
    sqlx::query("UPDATE comparison_validator_assignments SET due_at='2020-01-01T00:00:00Z',attempt=3 WHERE comparison_id=? AND validator_id=?")
        .bind(&comparison).bind(&officer).execute(&state.db).await.unwrap();
    crate::scoring::scheduler::schedule_all(&state.db)
        .await
        .unwrap();
    let status: String = sqlx::query_scalar("SELECT status FROM comparison_validator_assignments WHERE comparison_id=? AND validator_id=?")
        .bind(&comparison).bind(&officer).fetch_one(&state.db).await.unwrap();
    assert_eq!(status, "review_required");
    assert!(matches!(
        crate::scoring::review_required_comparisons(State(state.clone()), headers.clone()).await,
        Err(ApiError(StatusCode::FORBIDDEN, _))
    ));
    sqlx::query("UPDATE members SET role='admin' WHERE id=?")
        .bind(&officer)
        .execute(&state.db)
        .await
        .unwrap();
    let Json(review) = crate::scoring::review_required_comparisons(State(state), headers)
        .await
        .unwrap();
    assert_eq!(review[0]["id"], comparison);
    assert_eq!(review[0]["tasks"], 1);
}

#[tokio::test]
async fn concurrent_claims_create_one_run_and_one_pair() {
    let (state, _, officer, member) = fixture().await;
    add_validators(&state.db, &officer).await;
    add_evidence(&state.db, &member, &officer).await;
    let other = add_member(&state.db, "member", "Second candidate").await;
    add_evidence(&state.db, &other, &officer).await;
    let (first, second) = tokio::join!(
        crate::scoring::scheduler::schedule_skill(&state.db, "pytorch", "fixture-concurrent"),
        crate::scoring::scheduler::schedule_skill(&state.db, "pytorch", "fixture-concurrent"),
    );
    first.unwrap();
    second.unwrap();
    let attempts: i64 = sqlx::query_scalar(
        "SELECT attempts FROM comparison_schedule_runs WHERE run_key='fixture-concurrent:pytorch'",
    )
    .fetch_one(&state.db)
    .await
    .unwrap();
    let pairs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM skill_comparisons WHERE scheduler_run_key='fixture-concurrent:pytorch'")
        .fetch_one(&state.db).await.unwrap();
    assert_eq!(attempts, 1);
    assert_eq!(pairs, 1);
}

#[tokio::test]
async fn revoked_officer_cannot_read_or_vote_on_assigned_pair() {
    let (state, headers, officer, member) = fixture().await;
    add_validators(&state.db, &officer).await;
    add_evidence(&state.db, &member, &officer).await;
    let other = add_member(&state.db, "member", "Second candidate").await;
    add_evidence(&state.db, &other, &officer).await;
    crate::scoring::scheduler::schedule_skill(&state.db, "pytorch", "fixture-revoked")
        .await
        .unwrap();
    let comparison: String = sqlx::query_scalar(
        "SELECT id FROM skill_comparisons WHERE scheduler_run_key='fixture-revoked:pytorch'",
    )
    .fetch_one(&state.db)
    .await
    .unwrap();
    sqlx::query("UPDATE members SET role='member' WHERE id=?")
        .bind(&officer)
        .execute(&state.db)
        .await
        .unwrap();
    assert!(matches!(
        crate::scoring::comparison_queue(State(state.clone()), headers.clone()).await,
        Err(ApiError(StatusCode::FORBIDDEN, _))
    ));
    assert!(matches!(
        crate::scoring::cast_vote(
            State(state),
            headers,
            Path(comparison),
            Json(crate::scoring::Vote {
                outcome: "a".into()
            })
        )
        .await,
        Err(ApiError(StatusCode::FORBIDDEN, _))
    ));
}

#[tokio::test]
async fn validator_who_is_a_subject_is_not_assigned() {
    let (state, _, officer, member) = fixture().await;
    add_validators(&state.db, &officer).await;
    add_evidence(&state.db, &officer, &officer).await;
    add_evidence(&state.db, &member, &officer).await;
    crate::scoring::scheduler::schedule_skill(&state.db, "pytorch", "fixture-self-review")
        .await
        .unwrap();
    let pairs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM skill_comparisons WHERE scheduler_run_key='fixture-self-review:pytorch'")
        .fetch_one(&state.db).await.unwrap();
    assert_eq!(pairs, 0);
}
