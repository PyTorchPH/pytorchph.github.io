//! Collaborative event emails end to end: scoped views, cache hits and misses, the chain, send.
use super::*;
use crate::collab_mail::{chain, create, review, view};
use serde_json::{Value, json};

async fn officer_at(db: &sqlx::SqlitePool, name: &str, position: &str) -> session::Viewer {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,'officer',?)")
        .bind(&id).bind(&id).bind(format!("{name}@example.test")).bind(name).bind(format!("{name}-{}", &id[..6]))
        .bind(chrono::Utc::now().to_rfc3339()).execute(db).await.unwrap();
    sqlx::query("INSERT INTO member_positions(member_id, position_slug, assigned_at) VALUES (?, ?, '2026-09-30')").bind(&id).bind(position).execute(db).await.unwrap();
    session::Viewer {
        id,
        display_name: name.into(),
        role: "officer".into(),
    }
}

fn status(result: crate::ApiResult<Value>) -> StatusCode {
    match result {
        Ok(_) => StatusCode::OK,
        Err(ApiError(status, _)) => status,
    }
}

async fn view_of(db: &sqlx::SqlitePool, who: &session::Viewer, draft: &str) -> Value {
    view::draft_view(db, who, draft).await.unwrap()
}

#[tokio::test]
async fn parts_reach_only_their_owners_and_the_chain_sends_the_exact_approved_email() {
    let (state, ..) = fixture().await;
    let db = &state.db;
    let creator = officer_at(db, "creator", "head_partnerships_outreach").await;
    let coo = officer_at(db, "coo", "coo").await;
    let treasurer = officer_at(db, "treasurer", "treasurer").await;
    let secretary = officer_at(db, "secretary", "secretary_general").await;
    let president = officer_at(db, "president", "president").await;
    let comms = officer_at(db, "comms", "communications_officer").await;

    let created = create::create_draft(db, &creator, &json!({
        "title": "PyTorch Day", "subject": "Join PyTorch Day", "recipients": ["members@example.test"], "mode": "ai",
        "sections": [
            {"content": "PyTorch Day is on October 20 at the main hall.", "ownerPosition": "head_partnerships_outreach",
             "tags": [{"label": "date", "phrase": "October 20", "ownerPosition": "coo"}]},
            {"content": "Tickets are free thanks to our budget.", "ownerPosition": "treasurer", "questions": ["Is the budget approved?"]},
        ],
    })).await.unwrap();
    let draft = created["id"].as_str().unwrap().to_owned();

    // Scoping: the treasurer sees only their paragraph; the COO sees only their phrase; no one but
    // the creator sees the whole email before their turn.
    let mine = view_of(db, &treasurer, &draft).await;
    assert_eq!(mine["sections"].as_array().unwrap().len(), 1);
    assert_eq!(mine["tags"].as_array().unwrap().len(), 0);
    assert!(mine["email"].is_null());
    let coo_view = view_of(db, &coo, &draft).await;
    assert_eq!(coo_view["sections"].as_array().unwrap().len(), 0);
    assert_eq!(coo_view["tags"][0]["phrase"], "October 20");
    assert_eq!(view_of(db, &creator, &draft).await["stage"], "in_review");

    // The COO sets their date; the paragraph now carries it.
    let tag = coo_view["tags"][0]["id"].as_str().unwrap().to_owned();
    review::edit_tag(db, &coo, &draft, &tag, &json!({"phrase": "October 27"}))
        .await
        .unwrap();
    assert!(
        view_of(db, &creator, &draft).await["email"]["body"]
            .as_str()
            .unwrap()
            .contains("October 27")
    );

    // Someone else edits the treasurer's paragraph: a cache miss back to the treasurer.
    let section = view_of(db, &treasurer, &draft).await["sections"][0].clone();
    let section_id = section["id"].as_str().unwrap().to_owned();
    assert_eq!(
        status(
            review::confirm_section(
                db,
                &treasurer,
                &draft,
                &section_id,
                &json!({"basedOnHash": "stale"})
            )
            .await
        ),
        StatusCode::CONFLICT
    );
    let reply = review::edit_section(
        db,
        &creator,
        &draft,
        &section_id,
        &json!({"basedOnHash": section["contentHash"], "content": "Tickets are free."}),
    )
    .await
    .unwrap();
    assert_eq!(reply["state"], "changed");

    // The treasurer's own edit is approved at once; answering the question makes the email ready.
    let hash = view_of(db, &treasurer, &draft).await["sections"][0]["contentHash"].clone();
    let reply = review::edit_section(
        db,
        &treasurer,
        &draft,
        &section_id,
        &json!({"basedOnHash": hash, "content": "Tickets are free; the budget covers the venue."}),
    )
    .await
    .unwrap();
    assert_eq!(reply["state"], "confirmed");
    let question = view_of(db, &treasurer, &draft).await["sections"][0]["questions"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    review::answer_question(
        db,
        &treasurer,
        &draft,
        &question,
        &json!({"answer": "Yes, approved on Sept 28."}),
    )
    .await
    .unwrap();
    assert_eq!(view_of(db, &creator, &draft).await["stage"], "secretariat");

    // Chain order and the exact-email rule.
    let assembled = view_of(db, &secretary, &draft).await["email"]["assembledHash"].clone();
    assert_eq!(
        status(
            chain::approve_step(db, &president, &draft, &json!({"assembledHash": assembled})).await
        ),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        status(chain::approve_step(db, &secretary, &draft, &json!({"assembledHash": "old"})).await),
        StatusCode::CONFLICT
    );
    chain::approve_step(db, &secretary, &draft, &json!({"assembledHash": assembled}))
        .await
        .unwrap();
    assert_eq!(view_of(db, &creator, &draft).await["stage"], "president");

    // A later change voids the Secretariat approval: back to the Secretariat.
    let hash = view_of(db, &treasurer, &draft).await["sections"][0]["contentHash"].clone();
    review::edit_section(db, &treasurer, &draft, &section_id, &json!({"basedOnHash": hash, "content": "Tickets are free; the budget covers the venue and food."})).await.unwrap();
    assert_eq!(view_of(db, &creator, &draft).await["stage"], "secretariat");

    let assembled = view_of(db, &secretary, &draft).await["email"]["assembledHash"].clone();
    chain::approve_step(db, &secretary, &draft, &json!({"assembledHash": assembled}))
        .await
        .unwrap();
    chain::approve_step(db, &president, &draft, &json!({"assembledHash": assembled}))
        .await
        .unwrap();
    assert_eq!(view_of(db, &creator, &draft).await["stage"], "sending");

    assert_eq!(
        status(
            chain::send_draft(db, &treasurer, &draft, &json!({"assembledHash": assembled})).await
        ),
        StatusCode::FORBIDDEN
    );
    chain::send_draft(db, &comms, &draft, &json!({"assembledHash": assembled}))
        .await
        .unwrap();
    assert_eq!(
        count(
            db,
            "SELECT COUNT(*) FROM mail_dispatch WHERE status = 'pending'"
        )
        .await,
        1
    );
    assert_eq!(
        status(chain::send_draft(db, &comms, &draft, &json!({"assembledHash": assembled})).await),
        StatusCode::CONFLICT
    );
    assert_eq!(
        status(
            review::edit_section(
                db,
                &treasurer,
                &draft,
                &section_id,
                &json!({"basedOnHash": "x", "content": "late"})
            )
            .await
        ),
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn officers_outside_the_email_cannot_see_or_edit_it_and_vacant_owners_are_refused() {
    let (state, ..) = fixture().await;
    let db = &state.db;
    let creator = officer_at(db, "creator", "head_partnerships_outreach").await;
    // Not a part owner and not in the chain (the CMO would be: it is the fallback sender).
    let outsider = officer_at(db, "outsider", "cto").await;
    let _treasurer = officer_at(db, "treasurer", "treasurer").await;
    let base = json!({"title": "T", "subject": "S", "recipients": ["a@example.test"], "sections": [{"content": "Budget text.", "ownerPosition": "treasurer"}]});
    let draft = create::create_draft(db, &creator, &base).await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();

    assert!(view::draft_view(db, &outsider, &draft).await.is_err());
    assert!(
        view::list_drafts(db, &outsider)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );

    let vacant = json!({"title": "T", "subject": "S", "recipients": ["a@example.test"], "sections": [{"content": "Venue text.", "ownerPosition": "coo"}]});
    assert!(create::create_draft(db, &creator, &vacant).await.is_err());
    let bad_tag = json!({"title": "T", "subject": "S", "recipients": ["a@example.test"], "sections": [{"content": "Hello.", "ownerPosition": "treasurer", "tags": [{"label": "date", "phrase": "not in text", "ownerPosition": "treasurer"}]}]});
    assert!(create::create_draft(db, &creator, &bad_tag).await.is_err());
}
