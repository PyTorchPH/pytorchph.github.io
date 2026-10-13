//! Approval: 2026-10-13 AI projection requirements; fixtures never call an external model.
use super::*;
use crate::ai_privacy::{self, Ticket, key::PrivacyKey};
use serde_json::{Value, json};

async fn private_fixture() -> (Arc<AppState>, HeaderMap, String, String) {
    let (mut state, headers, officer, member) = fixture().await;
    Arc::get_mut(&mut state).unwrap().ai_privacy_key =
        Some(PrivacyKey::parse(&"11".repeat(32), "k1").unwrap());
    let source = json!({"evidence":{"items":[{"id":"real-record-id","title":"Jane Doe's award","description":"jane@example.test +639171234567","sourceUrl":"https://github.com/jane/private","imageUrl":"https://example.test/jane.png","privateNewField":"Passport ABC","verificationState":"user_verified","kind":"award","skills":["PyTorch","jane@example.test"],"completedAt":"2026-10-12T12:34:56Z"}]}});
    sqlx::query(
        "INSERT INTO portal_state(scope,state_key,value_json,updated_at) VALUES(?,?,?,'now')",
    )
    .bind(&officer)
    .bind("/api/product/career-evidence")
    .bind(source.to_string())
    .execute(&state.db)
    .await
    .unwrap();
    (state, headers, officer, member)
}

async fn grant(state: &Arc<AppState>, headers: &HeaderMap, purpose: &str, value: bool) {
    let (status, _) = portal_call(
        state,
        headers,
        Method::PUT,
        "/portal/api/member/ai-consent",
        json!({"purpose":purpose,"granted":value}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

async fn ticket(state: &Arc<AppState>, headers: &HeaderMap, purpose: &str) -> Value {
    let (status, value) = portal_call(
        state,
        headers,
        Method::POST,
        "/portal/api/member/ai-projection",
        json!({"purpose":purpose}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    value
}

#[test]
fn aliases_are_stable_scoped_versioned_and_do_not_use_names() {
    let one = PrivacyKey::parse(&"11".repeat(32), "k1").unwrap();
    let two = PrivacyKey::parse(&"22".repeat(32), "k2").unwrap();
    let alias = one
        .alias("learning_recommendations", "member", "id-a")
        .unwrap();
    assert_eq!(
        alias,
        one.alias("learning_recommendations", "member", "id-a")
            .unwrap()
    );
    assert_ne!(
        alias,
        one.alias("officer_assistant", "member", "id-a").unwrap()
    );
    assert_ne!(
        alias,
        one.alias("learning_recommendations", "member", "id-b")
            .unwrap()
    );
    assert_ne!(
        alias,
        two.alias("learning_recommendations", "member", "id-a")
            .unwrap()
    );
    assert!(PrivacyKey::parse(&"00".repeat(32), "k1").is_err());
    assert!(PrivacyKey::parse("bad", "k1").is_err());
}

#[tokio::test]
async fn consent_defaults_deny_and_projection_drops_identifiers_free_text_and_unknown_fields() {
    let (state, headers, officer, _) = private_fixture().await;
    let settings = portal_get(&state, &headers, "member/ai-consent").await;
    assert_eq!(settings["learning_recommendations"], false);
    assert_eq!(settings["model_training"], false);
    let (denied, _) = portal_call(
        &state,
        &headers,
        Method::POST,
        "/portal/api/member/ai-projection",
        json!({"purpose":"learning_recommendations"}),
    )
    .await;
    assert_eq!(denied, StatusCode::FORBIDDEN);
    grant(&state, &headers, "learning_recommendations", true).await;
    let value = ticket(&state, &headers, "learning_recommendations").await;
    let text = value.to_string();
    for forbidden in [
        "Jane",
        "jane@example",
        "63917",
        "github.com",
        "Passport",
        "real-record-id",
        &officer,
        "12:34:56",
    ] {
        assert!(!text.contains(forbidden), "Unexpected identifying field");
    }
    assert_eq!(
        value["projection"]["achievements"][0]["skills"],
        json!(["machine_learning"])
    );
    assert_eq!(
        value["projection"]["achievements"][0]["completion_month"],
        "2026-10"
    );
    let verified = ai_privacy::verify_ticket(
        State(state.clone()),
        Json(Ticket {
            id: value["ticket"]["id"].as_str().unwrap().into(),
            proof: value["ticket"]["proof"].as_str().unwrap().into(),
        }),
    )
    .await
    .unwrap();
    assert_eq!(
        verified.headers().get("cache-control").unwrap(),
        "private, no-store"
    );
}

#[tokio::test]
async fn client_cannot_weaken_policy_or_choose_other_subjects_but_can_omit_more_fields() {
    let (state, headers, _, member) = private_fixture().await;
    grant(&state, &headers, "learning_recommendations", true).await;
    for input in [
        json!({"purpose":"learning_recommendations","memberId":member}),
        json!({"purpose":"learning_recommendations","fields":{"name":{"sensitive_data":false}}}),
        json!({"purpose":"model_training"}),
        json!({"purpose":"learning_recommendations","omitFields":["name"]}),
    ] {
        let (status, _) = portal_call(
            &state,
            &headers,
            Method::POST,
            "/portal/api/member/ai-projection",
            input,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    let (status, value) = portal_call(
        &state,
        &headers,
        Method::POST,
        "/portal/api/member/ai-projection",
        json!({"purpose":"learning_recommendations","omitFields":["skills","completion_month"]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        value["projection"]["achievements"][0]
            .get("skills")
            .is_none()
    );
}

#[tokio::test]
async fn capabilities_are_tamper_proof_expire_revoke_and_owner_mapping_is_private() {
    let (state, headers, _, member) = private_fixture().await;
    grant(&state, &headers, "learning_recommendations", true).await;
    let issued = ticket(&state, &headers, "learning_recommendations").await;
    let id = issued["ticket"]["id"].as_str().unwrap();
    let proof = issued["ticket"]["proof"].as_str().unwrap();
    assert!(
        ai_privacy::verify_ticket(
            State(state.clone()),
            Json(Ticket {
                id: id.into(),
                proof: "00".repeat(32)
            })
        )
        .await
        .is_err()
    );
    let other = member_session(&state, &headers, &member, &"b".repeat(64)).await;
    let (status, _) = portal_call(
        &state,
        &other,
        Method::POST,
        "/portal/api/member/ai-result-context",
        json!({"requestId":id}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, owned) = portal_call(
        &state,
        &headers,
        Method::POST,
        "/portal/api/member/ai-result-context",
        json!({"requestId":id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(owned["owned"], true);
    grant(&state, &headers, "learning_recommendations", false).await;
    grant(&state, &headers, "learning_recommendations", true).await;
    assert!(
        ai_privacy::verify_ticket(
            State(state.clone()),
            Json(Ticket {
                id: id.into(),
                proof: proof.into()
            })
        )
        .await
        .is_err()
    );
    let issued = ticket(&state, &headers, "learning_recommendations").await;
    sqlx::query("UPDATE ai_projection_requests SET expires_at=0")
        .execute(&state.db)
        .await
        .unwrap();
    assert!(
        ai_privacy::verify_ticket(
            State(state.clone()),
            Json(Ticket {
                id: issued["ticket"]["id"].as_str().unwrap().into(),
                proof: issued["ticket"]["proof"].as_str().unwrap().into()
            })
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn officer_projections_suppress_small_counts_and_recheck_current_roles() {
    let (state, headers, officer, _) = private_fixture().await;
    grant(&state, &headers, "officer_assistant", true).await;
    let (status, value) = portal_call(
        &state,
        &headers,
        Method::POST,
        "/portal/api/officer/ai-projection",
        json!({"purpose":"officer_assistant","view":"demographics"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["projection"]["suppressed"], true);
    sqlx::query("UPDATE members SET role='member' WHERE id=?")
        .bind(officer)
        .execute(&state.db)
        .await
        .unwrap();
    assert!(
        ai_privacy::verify_ticket(
            State(state.clone()),
            Json(Ticket {
                id: value["ticket"]["id"].as_str().unwrap().into(),
                proof: value["ticket"]["proof"].as_str().unwrap().into()
            })
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn missing_key_rotation_and_account_deletion_fail_closed() {
    let (mut state, headers, officer, _) = private_fixture().await;
    grant(&state, &headers, "learning_recommendations", true).await;
    Arc::get_mut(&mut state).unwrap().ai_privacy_key = None;
    let (status, _) = portal_call(
        &state,
        &headers,
        Method::POST,
        "/portal/api/member/ai-projection",
        json!({"purpose":"learning_recommendations"}),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    Arc::get_mut(&mut state).unwrap().ai_privacy_key =
        Some(PrivacyKey::parse(&"11".repeat(32), "k1").unwrap());
    let issued = ticket(&state, &headers, "learning_recommendations").await;
    Arc::get_mut(&mut state).unwrap().ai_privacy_key =
        Some(PrivacyKey::parse(&"22".repeat(32), "k2").unwrap());
    assert!(
        ai_privacy::verify_ticket(
            State(state.clone()),
            Json(Ticket {
                id: issued["ticket"]["id"].as_str().unwrap().into(),
                proof: issued["ticket"]["proof"].as_str().unwrap().into()
            })
        )
        .await
        .is_err()
    );
    sqlx::query("DELETE FROM members WHERE id=?")
        .bind(officer)
        .execute(&state.db)
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_projection_requests")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
