//! Creating a collaborative draft from the creator's split (AI-suggested and confirmed by the
//! creator, or written by hand). Parts the creator owns start confirmed; everything else waits
//! for its owner.
//!
//! Module map (caller-first):
//!   create_draft        parse → check owners exist → store draft, sections, tags, questions
//!   ├─ valid_recipients plain `local@domain` addresses, 1 to 25
//!   └─ insert_section   one section with its first revision, tags, and questions
use super::{
    access::{ensure_holders, held_positions},
    audit::{self, Change},
    chain::advance,
    model::{NewSection, parse_new_draft, text_hash},
};
use crate::{ApiResult, bad, identity::session::Viewer, internal};
use serde_json::{Value, json};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::HashSet;
use uuid::Uuid;

const MAX_RECIPIENTS: usize = 25;

pub(crate) async fn create_draft(
    db: &SqlitePool,
    actor: &Viewer,
    input: &Value,
) -> ApiResult<Value> {
    let draft = parse_new_draft(input)?;
    if !valid_recipients(&draft.recipients) {
        return Err(bad("Add 1 to 25 recipient email addresses"));
    }
    let owned = held_positions(db, &actor.id).await?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let mut tx = db.begin().await.map_err(internal)?;
    let owners: HashSet<String> = draft
        .sections
        .iter()
        .flat_map(|section| {
            std::iter::once(section.owner_position.clone())
                .chain(section.tags.iter().map(|tag| tag.owner_position.clone()))
        })
        .collect();
    ensure_holders(&mut tx, &owners).await?;
    sqlx::query("INSERT INTO collab_drafts(id, title, subject, recipients_json, creator_id, mode, stage, created_at, updated_at) VALUES (?,?,?,?,?,?,'in_review',?,?)")
        .bind(&id).bind(&draft.title).bind(&draft.subject)
        .bind(serde_json::to_string(&draft.recipients).map_err(internal)?)
        .bind(&actor.id).bind(draft.mode).bind(&now).bind(&now)
        .execute(&mut *tx).await.map_err(internal)?;
    for (ord, section) in draft.sections.iter().enumerate() {
        insert_section(&mut tx, &id, ord as i64, section, actor, &owned, draft.mode).await?;
    }
    audit::record(
        &mut tx,
        Change {
            draft_id: &id,
            actor_id: &actor.id,
            action: "created",
            target_id: &id,
            from_hash: "",
            to_hash: "",
        },
    )
    .await?;
    advance(&mut tx, &id).await?;
    tx.commit().await.map_err(internal)?;
    Ok(json!({"id": id}))
}

fn valid_recipients(recipients: &[String]) -> bool {
    !recipients.is_empty()
        && recipients.len() <= MAX_RECIPIENTS
        && recipients.iter().all(|address| {
            let parts: Vec<&str> = address.split('@').collect();
            parts.len() == 2
                && parts.iter().all(|part| !part.is_empty())
                && !address.chars().any(|c| c.is_whitespace() || c.is_control())
        })
}

// The creator's own positions need no second look; other owners review their parts.
async fn insert_section(
    tx: &mut Transaction<'_, Sqlite>,
    draft_id: &str,
    ord: i64,
    section: &NewSection,
    actor: &Viewer,
    owned: &HashSet<String>,
    mode: &str,
) -> ApiResult<()> {
    let section_id = Uuid::new_v4().to_string();
    let hash = text_hash(&section.content);
    let state = if owned.contains(&section.owner_position) {
        "confirmed"
    } else {
        "pending"
    };
    sqlx::query("INSERT INTO collab_sections(id, draft_id, ord, owner_position, state, revision, content, content_hash) VALUES (?,?,?,?,?,1,?,?)")
        .bind(&section_id).bind(draft_id).bind(ord).bind(&section.owner_position).bind(state).bind(&section.content).bind(&hash)
        .execute(&mut **tx).await.map_err(internal)?;
    sqlx::query("INSERT INTO collab_section_revisions(section_id, revision, content, content_hash, author_id, source, created_at) VALUES (?,1,?,?,?,?,?)")
        .bind(&section_id).bind(&section.content).bind(&hash).bind(&actor.id)
        .bind(if mode == "ai" { "ai" } else { "human" }).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut **tx).await.map_err(internal)?;
    for tag in &section.tags {
        let tag_state = if owned.contains(&tag.owner_position) {
            "confirmed"
        } else {
            "pending"
        };
        sqlx::query("INSERT INTO collab_tags(id, section_id, label, phrase, owner_position, state) VALUES (?,?,?,?,?,?)")
            .bind(Uuid::new_v4().to_string()).bind(&section_id).bind(&tag.label).bind(&tag.phrase).bind(&tag.owner_position).bind(tag_state)
            .execute(&mut **tx).await.map_err(internal)?;
    }
    for prompt in &section.questions {
        sqlx::query("INSERT INTO collab_questions(id, section_id, prompt) VALUES (?,?,?)")
            .bind(Uuid::new_v4().to_string())
            .bind(&section_id)
            .bind(prompt)
            .execute(&mut **tx)
            .await
            .map_err(internal)?;
    }
    Ok(())
}
