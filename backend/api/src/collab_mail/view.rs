//! What each member sees. The server scopes every view: part owners get only their parts (a tag
//! owner sees only their phrase), plus an outline without text; the full email is shown to the
//! creator and to the chain position whose turn it is.
//!
//! Module map (caller-first):
//!   list_drafts        drafts this member is part of, with their open tasks
//!   draft_view         one draft, scoped to the viewer
//!   ├─ sections_for    full sections the viewer owns (all of them for the creator)
//!   ├─ tags_for        phrases the viewer owns inside other people's sections
//!   └─ chain_turn      the position whose approval or send the draft is waiting for
use super::{
    PRESIDENT, SECRETARIAT,
    access::{held_positions, sender_position},
    chain::assembled_now,
    review::ensure_involved,
};
use crate::{ApiResult, identity::session::Viewer, internal};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use std::collections::HashSet;

type SectionRow = (String, i64, String, String, String, String, String);

pub(crate) async fn list_drafts(db: &SqlitePool, actor: &Viewer) -> ApiResult<Value> {
    let held = held_positions(db, &actor.id).await?;
    let drafts: Vec<(String, String, String, String, String)> = sqlx::query_as("SELECT id, title, stage, creator_id, updated_at FROM collab_drafts ORDER BY updated_at DESC LIMIT 200")
        .fetch_all(db).await.map_err(internal)?;
    let mut rows = Vec::new();
    for (id, title, stage, creator, updated_at) in drafts {
        let tasks = open_tasks(db, &id, &held).await?;
        let turn = chain_turn(db, &stage).await?;
        let my_turn = turn
            .as_deref()
            .is_some_and(|position| held.contains(position));
        if creator != actor.id && tasks == 0 && !my_turn && !owns_any_part(db, &id, &held).await? {
            continue;
        }
        rows.push(json!({"id": id, "title": title, "stage": stage, "openTasks": tasks, "myTurn": my_turn, "isCreator": creator == actor.id, "updatedAt": updated_at}));
    }
    Ok(Value::Array(rows))
}

pub(crate) async fn draft_view(
    db: &SqlitePool,
    actor: &Viewer,
    draft_id: &str,
) -> ApiResult<Value> {
    let mut tx = db.begin().await.map_err(internal)?;
    ensure_involved(&mut tx, actor, draft_id).await?;
    let (body, assembled_hash) = assembled_now(&mut tx, draft_id).await?;
    tx.commit().await.map_err(internal)?;
    let (title, subject, recipients_json, creator, mode, stage): (String, String, String, String, String, String) =
        sqlx::query_as("SELECT title, subject, recipients_json, creator_id, mode, stage FROM collab_drafts WHERE id = ?")
            .bind(draft_id).fetch_one(db).await.map_err(internal)?;
    let held = held_positions(db, &actor.id).await?;
    let is_creator = creator == actor.id;
    let turn = chain_turn(db, &stage).await?;
    let my_turn = turn
        .as_deref()
        .is_some_and(|position| held.contains(position));
    let outline: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT s.ord, p.title, s.state FROM collab_sections s JOIN positions p ON p.slug = s.owner_position WHERE s.draft_id = ? ORDER BY s.ord",
    )
    .bind(draft_id).fetch_all(db).await.map_err(internal)?;
    let sections = sections_for(db, draft_id, &held, is_creator).await?;
    let owned_section_ids: HashSet<String> = sections
        .iter()
        .filter_map(|section| section["id"].as_str().map(str::to_owned))
        .collect();
    let show_email = is_creator || my_turn;
    Ok(json!({
        "id": draft_id, "title": title, "subject": subject, "mode": mode, "stage": stage,
        "isCreator": is_creator, "myTurn": my_turn, "turnPosition": turn,
        "outline": outline.into_iter().map(|(ord, owner, state)| json!({"ord": ord, "owner": owner, "state": state})).collect::<Vec<_>>(),
        "sections": sections,
        "tags": tags_for(db, draft_id, &held, &owned_section_ids).await?,
        "email": show_email.then(|| json!({"subject": subject, "recipients": serde_json::from_str::<Value>(&recipients_json).unwrap_or(Value::Null), "body": body, "assembledHash": assembled_hash})),
    }))
}

async fn sections_for(
    db: &SqlitePool,
    draft_id: &str,
    held: &HashSet<String>,
    is_creator: bool,
) -> ApiResult<Vec<Value>> {
    let rows: Vec<SectionRow> = sqlx::query_as(
        "SELECT s.id, s.ord, s.owner_position, p.title, s.state, s.content, s.content_hash FROM collab_sections s JOIN positions p ON p.slug = s.owner_position WHERE s.draft_id = ? ORDER BY s.ord",
    )
    .bind(draft_id).fetch_all(db).await.map_err(internal)?;
    let mut out = Vec::new();
    for (id, ord, owner, owner_title, state, content, hash) in rows {
        if !is_creator && !held.contains(&owner) {
            continue;
        }
        let tags: Vec<(String, String, String, String, String)> = sqlx::query_as(
            "SELECT t.id, t.label, t.phrase, p.title, t.state FROM collab_tags t JOIN positions p ON p.slug = t.owner_position WHERE t.section_id = ?",
        )
        .bind(&id).fetch_all(db).await.map_err(internal)?;
        let questions: Vec<(String, String, Option<String>)> = sqlx::query_as(
            "SELECT q.id, q.prompt, a.answer FROM collab_questions q LEFT JOIN collab_answers a ON a.question_id = q.id WHERE q.section_id = ?",
        )
        .bind(&id).fetch_all(db).await.map_err(internal)?;
        out.push(json!({
            "id": id, "ord": ord, "owner": owner_title, "isMine": held.contains(&owner), "state": state, "content": content, "contentHash": hash,
            "tags": tags.into_iter().map(|(id, label, phrase, owner, state)| json!({"id": id, "label": label, "phrase": phrase, "owner": owner, "state": state})).collect::<Vec<_>>(),
            "questions": questions.into_iter().map(|(id, prompt, answer)| json!({"id": id, "prompt": prompt, "answer": answer})).collect::<Vec<_>>(),
        }));
    }
    Ok(out)
}

async fn tags_for(
    db: &SqlitePool,
    draft_id: &str,
    held: &HashSet<String>,
    shown_sections: &HashSet<String>,
) -> ApiResult<Vec<Value>> {
    let rows: Vec<(String, String, String, String, String, i64, String)> = sqlx::query_as(
        "SELECT t.id, t.section_id, t.label, t.phrase, t.state, s.ord, t.owner_position FROM collab_tags t JOIN collab_sections s ON s.id = t.section_id WHERE s.draft_id = ? ORDER BY s.ord",
    )
    .bind(draft_id).fetch_all(db).await.map_err(internal)?;
    Ok(rows
        .into_iter()
        .filter(|(_, section, .., owner)| held.contains(owner) && !shown_sections.contains(section))
        .map(|(id, _, label, phrase, state, ord, _)| json!({"id": id, "label": label, "phrase": phrase, "state": state, "sectionOrd": ord}))
        .collect())
}

async fn chain_turn(db: &SqlitePool, stage: &str) -> ApiResult<Option<String>> {
    Ok(match stage {
        "secretariat" => Some(SECRETARIAT.to_owned()),
        "president" => Some(PRESIDENT.to_owned()),
        "sending" => {
            let mut tx = db.begin().await.map_err(internal)?;
            let sender = sender_position(&mut tx).await?;
            tx.commit().await.map_err(internal)?;
            Some(sender.to_owned())
        }
        _ => None,
    })
}

async fn open_tasks(db: &SqlitePool, draft_id: &str, held: &HashSet<String>) -> ApiResult<i64> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT owner_position FROM collab_sections WHERE draft_id = ?1 AND state != 'confirmed' \
         UNION ALL SELECT t.owner_position FROM collab_tags t JOIN collab_sections s ON s.id = t.section_id WHERE s.draft_id = ?1 AND t.state != 'confirmed' \
         UNION ALL SELECT s.owner_position FROM collab_questions q JOIN collab_sections s ON s.id = q.section_id LEFT JOIN collab_answers a ON a.question_id = q.id WHERE s.draft_id = ?1 AND a.question_id IS NULL",
    )
    .bind(draft_id).fetch_all(db).await.map_err(internal)?;
    Ok(rows.iter().filter(|(owner,)| held.contains(owner)).count() as i64)
}

async fn owns_any_part(db: &SqlitePool, draft_id: &str, held: &HashSet<String>) -> ApiResult<bool> {
    let owners: Vec<(String,)> = sqlx::query_as(
        "SELECT owner_position FROM collab_sections WHERE draft_id = ?1 UNION SELECT t.owner_position FROM collab_tags t JOIN collab_sections s ON s.id = t.section_id WHERE s.draft_id = ?1",
    )
    .bind(draft_id).fetch_all(db).await.map_err(internal)?;
    Ok(owners.iter().any(|(owner,)| held.contains(owner)))
}
