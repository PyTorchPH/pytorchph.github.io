//! Client-compiled skill lists: who may publish, and the member tally they drive.
use super::*;
use crate::skill_taxonomy::{publish_taxonomy, raw_skill_counts, skill_tally};
use serde_json::json;

async fn person(db: &sqlx::SqlitePool, name: &str) -> session::Viewer {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,'officer',?)")
        .bind(&id).bind(&id).bind(format!("{name}@example.test")).bind(name).bind(format!("{name}-{}", &id[..6]))
        .bind(chrono::Utc::now().to_rfc3339()).execute(db).await.unwrap();
    session::Viewer {
        id,
        display_name: name.into(),
        role: "officer".into(),
    }
}

async fn achievements(db: &sqlx::SqlitePool, member: &session::Viewer, items: serde_json::Value) {
    sqlx::query("INSERT INTO portal_state(scope,state_key,value_json,updated_at) VALUES (?,'/api/product/career-evidence',?,'2026-09-30')")
        .bind(&member.id).bind(json!({"evidence": {"items": items}}).to_string()).execute(db).await.unwrap();
}

fn taxonomy() -> serde_json::Value {
    json!({"skills": [
        {"name": "Web scraping and automation", "category": "Engineering", "aliases": ["BeautifulSoup", "Playwright"]},
        {"name": "Deep learning", "category": "Machine learning", "aliases": ["PyTorch"]},
    ]})
}

#[tokio::test]
async fn only_technology_officers_publish_and_the_tally_counts_each_member_once_per_skill() {
    let (state, ..) = fixture().await;
    let cto = person(&state.db, "cto").await;
    sqlx::query("INSERT INTO member_positions(member_id, position_slug, assigned_at) VALUES (?, 'cto', '2026-09-30')").bind(&cto.id).execute(&state.db).await.unwrap();
    let treasurer = person(&state.db, "treasurer").await;
    sqlx::query("INSERT INTO member_positions(member_id, position_slug, assigned_at) VALUES (?, 'treasurer', '2026-09-30')").bind(&treasurer.id).execute(&state.db).await.unwrap();

    achievements(
        &state.db,
        &cto,
        json!([
            {"verificationState": "user_verified", "skills": ["BeautifulSoup", "Playwright"]},
            {"verificationState": "draft", "skills": ["PyTorch"]},
        ]),
    )
    .await;
    achievements(
        &state.db,
        &treasurer,
        json!([{"verificationState": "source_matched", "skills": ["pytorch", "Excel"]}]),
    )
    .await;

    let raw: Vec<String> = raw_skill_counts(&state.db)
        .await
        .unwrap()
        .into_iter()
        .map(|(raw, _)| raw)
        .collect();
    assert!(
        !raw.contains(&"pytorch".to_owned())
            || raw.iter().filter(|word| *word == "pytorch").count() == 1
    );
    assert!(raw.contains(&"beautifulsoup".to_owned()) && raw.contains(&"excel".to_owned()));

    assert!(
        publish_taxonomy(&state.db, &treasurer, &taxonomy())
            .await
            .is_err()
    );
    publish_taxonomy(&state.db, &cto, &taxonomy())
        .await
        .unwrap();

    let tally = skill_tally(&state.db).await.unwrap();
    let skills = tally["skills"].as_array().unwrap();
    // The CTO's two scraping words count once; the draft PyTorch item does not count.
    assert_eq!(
        skills
            .iter()
            .find(|s| s["skill"] == "Web scraping and automation")
            .unwrap()["members"],
        1
    );
    assert_eq!(
        skills
            .iter()
            .find(|s| s["skill"] == "Deep learning")
            .unwrap()["members"],
        1
    );
    assert_eq!(tally["unmappedRaw"], 1);
}
