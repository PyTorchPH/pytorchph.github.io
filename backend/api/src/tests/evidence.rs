//! Officer evidence review, sanctions, appeals and the manual evidence queue.
use super::*;

#[tokio::test]
async fn officer_review_feeds_leaderboard_and_sanction_appeal_restores_eligibility() {
    let (state, officer, officer_id, member_id) = fixture().await;
    let token = "e".repeat(64);
    sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
        .bind(hex::encode(Sha256::digest(token.as_bytes())))
        .bind(&member_id)
        .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
        .execute(&state.db)
        .await
        .unwrap();
    let mut member = officer.clone();
    member.insert("cookie", format!("ph_session={token}").parse().unwrap());
    let now = chrono::Utc::now();
    sqlx::query("INSERT INTO leaderboard_seasons VALUES ('test-now','Test season',?,?)")
        .bind((now - chrono::Duration::days(1)).to_rfc3339())
        .bind((now + chrono::Duration::days(1)).to_rfc3339())
        .execute(&state.db)
        .await
        .unwrap();
    claim(&state, "c-ok", &member_id, "manual").await;
    claim(&state, "c-fake", &member_id, "manual").await;
    claim(&state, "c-own", &officer_id, "manual").await;

    let (status, queue) = portal_call(
        &state,
        &officer,
        Method::GET,
        "/portal/api/officer/evidence",
        serde_json::json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        queue
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["provenance"] == "manual_pending")
    );

    let (status, _) = portal_call(
        &state,
        &officer,
        Method::PATCH,
        "/portal/api/officer/evidence/c-own",
        serde_json::json!({"decision":"approve","level":"winner_top_award","reason":""}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "no self-review");
    let (status, _) = portal_call(
        &state,
        &member,
        Method::PATCH,
        "/portal/api/officer/evidence/c-ok",
        serde_json::json!({"decision":"approve","level":"contributor","reason":""}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "members cannot review");
    let (status, approved) = portal_call(
        &state,
        &officer,
        Method::PATCH,
        "/portal/api/officer/evidence/c-ok",
        serde_json::json!({"decision":"approve","level":"contributor","reason":""}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(approved["provenance"], "officer_reviewed");
    assert_eq!(
        approved["points"], 60,
        "contributor = 2 units x 10 x manual weight 3"
    );
    assert_eq!(approved["proposedLevel"], "contributor");

    let (_, board) = portal_call(
        &state,
        &member,
        Method::GET,
        "/portal/api/member/leaderboard?page=1&pageSize=25&view=both",
        serde_json::json!(null),
    )
    .await;
    let me = board["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["isCurrentUser"] == true)
        .unwrap()
        .clone();
    assert_eq!(me["verifiedPoints"], 60);
    assert_eq!(
        me["pendingPoints"], 30,
        "one pending manual claim at participation"
    );
    assert_eq!(board["season"]["state"], "active");
    let (_, overview) = portal_call(
        &state,
        &member,
        Method::GET,
        "/portal/api/member/overview",
        serde_json::json!(null),
    )
    .await;
    assert_eq!(overview["summary"]["points"], 60);
    assert_eq!(overview["summary"]["verifiedEvidence"], 1);

    let (status, _) = portal_call(
        &state,
        &officer,
        Method::PATCH,
        "/portal/api/officer/evidence/c-fake",
        serde_json::json!({"decision":"confirm_falsification","reason":"Certificate was edited"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, cases) = portal_call(
        &state,
        &member,
        Method::GET,
        "/portal/api/evidence/integrity",
        serde_json::json!(null),
    )
    .await;
    let sanction_id = cases[0]["sanctionId"].as_str().unwrap().to_owned();
    assert_eq!(cases[0]["reason"], "Certificate was edited");
    let (_, board) = portal_call(
        &state,
        &member,
        Method::GET,
        "/portal/api/member/leaderboard",
        serde_json::json!(null),
    )
    .await;
    assert!(
        board["entries"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["isCurrentUser"] == false),
        "sanctioned member is not ranked"
    );

    let (status, _) = portal_call(
        &state,
        &member,
        Method::POST,
        "/portal/api/evidence/integrity",
        serde_json::json!({"sanctionId": sanction_id, "note": "I can share the original file."}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = portal_call(
        &state,
        &member,
        Method::POST,
        "/portal/api/evidence/integrity",
        serde_json::json!({"sanctionId": sanction_id, "note": "Second appeal while one is open."}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (_, appeals) = portal_call(
        &state,
        &officer,
        Method::GET,
        "/portal/api/officer/evidence/appeals",
        serde_json::json!(null),
    )
    .await;
    assert_eq!(appeals[0]["violationType"], "manual_falsification");
    let appeal_id = appeals[0]["id"].as_str().unwrap().to_owned();
    let (status, _) = portal_call(
        &state,
        &officer,
        Method::PATCH,
        &format!("/portal/api/officer/evidence/appeals/{appeal_id}"),
        serde_json::json!({"decision":"restore","reason":"Original file verified"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, cases) = portal_call(
        &state,
        &member,
        Method::GET,
        "/portal/api/evidence/integrity",
        serde_json::json!(null),
    )
    .await;
    assert_eq!(cases, serde_json::json!([]));
    let (_, board) = portal_call(
        &state,
        &member,
        Method::GET,
        "/portal/api/member/leaderboard",
        serde_json::json!(null),
    )
    .await;
    assert!(
        board["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["isCurrentUser"] == true)
    );

    sqlx::query("DELETE FROM members WHERE id = ?")
        .bind(&member_id)
        .execute(&state.db)
        .await
        .unwrap();
    for table in [
        "evidence_claims WHERE member_id != '' AND id != 'c-own'",
        "evidence_claim_reviews",
        "leaderboard_sanctions",
        "evidence_appeals",
    ] {
        assert_eq!(
            count(&state.db, &format!("SELECT COUNT(*) FROM {table}")).await,
            0,
            "{table}"
        );
    }
}

#[tokio::test]
async fn approved_manual_evidence_enters_the_officer_review_queue() {
    let (state, officer, _, member_id) = fixture().await;
    let token = "f".repeat(64);
    sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
        .bind(hex::encode(Sha256::digest(token.as_bytes())))
        .bind(&member_id)
        .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
        .execute(&state.db)
        .await
        .unwrap();
    let mut member = officer.clone();
    member.insert("cookie", format!("ph_session={token}").parse().unwrap());
    let item = |title: &str| serde_json::json!({"item": {"title": title, "sourceUrl": "https://github.com/example/repo", "description": "Built a classifier"}, "approve": true});

    let (status, draft) = portal_call(
        &state,
        &member,
        Method::POST,
        "/portal/api/product/evidence",
        serde_json::json!({"item": {"title": "Draft only"}}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    assert_eq!(
        count(&state.db, "SELECT COUNT(*) FROM evidence_claims").await,
        0,
        "drafts stay private"
    );

    let (_, created) = portal_call(
        &state,
        &member,
        Method::POST,
        "/portal/api/product/evidence",
        item("Image classifier"),
    )
    .await;
    let id = created["item"]["id"].as_str().unwrap().to_owned();
    let (_, queue) = portal_call(
        &state,
        &officer,
        Method::GET,
        "/portal/api/officer/evidence",
        serde_json::json!(null),
    )
    .await;
    assert_eq!(queue[0]["id"], id.as_str());
    assert_eq!(queue[0]["provenance"], "manual_pending");

    portal_call(
        &state,
        &member,
        Method::PATCH,
        &format!("/portal/api/product/evidence/{id}"),
        item("Image classifier v2"),
    )
    .await;
    assert_eq!(
        count(
            &state.db,
            "SELECT COUNT(*) FROM evidence_claims WHERE title='Image classifier v2'"
        )
        .await,
        1
    );

    let (status, _) = portal_call(
        &state,
        &officer,
        Method::PATCH,
        &format!("/portal/api/officer/evidence/{id}"),
        serde_json::json!({"decision":"approve","level":"participation","reason":""}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    portal_call(
        &state,
        &member,
        Method::PATCH,
        &format!("/portal/api/product/evidence/{id}"),
        item("Edited after review"),
    )
    .await;
    assert_eq!(count(&state.db, "SELECT COUNT(*) FROM evidence_claims WHERE title='Image classifier v2' AND status='approved'").await, 1, "reviewed claims are final");
}

#[tokio::test]
async fn a_member_deletes_their_own_achievement_and_its_points_are_revoked() {
    let (state, officer_headers, _, member_id) = fixture().await;
    let headers = member_session(&state, &officer_headers, &member_id, &"3".repeat(64)).await;
    let item = serde_json::json!({"item": {"title": "Built a PyTorch demo", "sourceUrl": "https://github.com/example/demo", "description": "A demo"}, "approve": true});
    let (status, created) = portal_call(
        &state,
        &headers,
        Method::POST,
        "/portal/api/product/evidence",
        item,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let id: String = sqlx::query_scalar("SELECT id FROM evidence_claims WHERE member_id = ?")
        .bind(&member_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO point_ledger(id,member_id,source_type,source_id,delta,reason,created_at) VALUES ('p1',?,'verified_evidence',?,30,'officer_verified','2026-09-30')")
        .bind(&member_id).bind(&id).execute(&state.db).await.unwrap();

    // Another member cannot delete it: it is not in their own list.
    let (other_status, _) = portal_call(
        &state,
        &officer_headers,
        Method::DELETE,
        &format!("/portal/api/product/evidence/{id}"),
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(other_status, StatusCode::NOT_FOUND);

    let (status, reply) = portal_call(
        &state,
        &headers,
        Method::DELETE,
        &format!("/portal/api/product/evidence/{id}"),
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["pointsRevoked"], 30);
    assert_eq!(
        count(&state.db, "SELECT COUNT(*) FROM evidence_claims").await,
        0
    );
    assert_eq!(
        count(
            &state.db,
            "SELECT COUNT(*) FROM point_ledger WHERE source_type = 'verified_evidence'"
        )
        .await,
        0
    );
    assert_eq!(
        count(
            &state.db,
            "SELECT COUNT(*) FROM audit_events WHERE operation = 'evidence.member_deleted'"
        )
        .await,
        1
    );
}
