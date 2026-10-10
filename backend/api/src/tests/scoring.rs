//! Blind comparison payloads contain only achievements needed for the skill judgment.
use super::*;

#[tokio::test]
async fn assigned_validator_sees_achievements_without_identity_or_training_features() {
    let (state, headers, officer, member) = fixture().await;
    let other = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,'member',?)")
        .bind(&other).bind(&other).bind(format!("{other}@example.test"))
        .bind("Hidden Candidate").bind("hidden-candidate")
        .bind(chrono::Utc::now().to_rfc3339()).execute(&state.db).await.unwrap();
    sqlx::query(
        "INSERT INTO scoring_validators(member_id,skill_slug,assigned_at) VALUES (?,'pytorch',?)",
    )
    .bind(&officer)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(&state.db)
    .await
    .unwrap();
    let evidence = serde_json::json!({"achievements":[{"kind":"hackathon","place":1,"basePoints":50,"date":"2026-10-01"}],"featureTotals":{"hackathon":50}}).to_string();
    let (a, b) = if member < other {
        (&member, &other)
    } else {
        (&other, &member)
    };
    sqlx::query("INSERT INTO skill_comparisons(id,skill_slug,member_a,member_b,evidence_cutoff,evidence_a_json,evidence_b_json,created_at) VALUES ('blind-test','pytorch',?,?,?,?,?,?)")
        .bind(a).bind(b).bind(chrono::Utc::now().to_rfc3339())
        .bind(&evidence).bind(&evidence).bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db).await.unwrap();

    let Json(queue) = crate::scoring::comparison_queue(State(state), headers)
        .await
        .unwrap();
    let text = queue.to_string();
    assert_eq!(queue[0]["a"]["achievements"][0]["basePoints"], 50);
    for private in [
        &member[..],
        &other[..],
        "Hidden Candidate",
        "hidden-candidate",
        "featureTotals",
    ] {
        assert!(!text.contains(private), "private field leaked: {private}");
    }
}
