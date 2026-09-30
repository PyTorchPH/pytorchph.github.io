//! Reviewing parts. Sections and tags carry a content hash: confirming unchanged text is a cache
//! hit; the owner's own edit is approved at once; anyone else's edit is a cache miss that sends the
//! part back to its owner. Edits name the hash they were based on, so concurrent edits never
//! silently overwrite each other (409 with the latest text instead).
//!
//! Module map (caller-first):
//!   edit_section        new text for a section (owner: confirmed; others: changed)
//!   confirm_section     owner accepts the current text as is
//!   edit_tag            tag owner sets their phrase (replaced in the section); same-label tags
//!                       elsewhere are marked changed so their owners re-check
//!   answer_question     section owner supplies missing information
//!   ├─ load_section     the section, checked to belong to this draft and still editable
//!   ├─ ensure_involved  creator, part owners, or chain positions of this draft
//!   └─ ensure_based_on  compare-and-swap on the section hash
use super::{
    PRESIDENT, SECRETARIAT, SENDER, SENDER_FALLBACK,
    access::holds,
    audit::{self, Change},
    chain::{advance, stage_of},
    model::{MAX_ANSWER, clean_text, text_hash},
};
use crate::{ApiError, ApiResult, bad, identity::session::Viewer, internal};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::{Sqlite, SqlitePool, Transaction};

type Tx<'a> = Transaction<'a, Sqlite>;

const MAX_SECTION: usize = 4000;
const MAX_PHRASE: usize = 300;

struct Section {
    owner_position: String,
    revision: i64,
    content: String,
    content_hash: String,
}

pub(crate) async fn edit_section(
    db: &SqlitePool,
    actor: &Viewer,
    draft_id: &str,
    section_id: &str,
    input: &Value,
) -> ApiResult<Value> {
    let content = clean_text(input.get("content"), MAX_SECTION)
        .ok_or_else(|| bad("A section needs text (up to 4000 characters)"))?;
    let mut tx = db.begin().await.map_err(internal)?;
    let section = load_section(&mut tx, draft_id, section_id).await?;
    ensure_involved(&mut tx, actor, draft_id).await?;
    ensure_based_on(&section, input)?;
    let is_owner = holds(&mut tx, &actor.id, &section.owner_position).await?;
    let hash = text_hash(&content);
    let state = if is_owner { "confirmed" } else { "changed" };
    if hash != section.content_hash {
        write_revision(&mut tx, section_id, &section, &content, &hash, &actor.id).await?;
        // Tagged phrases the edit removed go back to their owners.
        sqlx::query("UPDATE collab_tags SET state = 'changed' WHERE section_id = ? AND instr(?, phrase) = 0")
            .bind(section_id).bind(&content).execute(&mut *tx).await.map_err(internal)?;
    }
    sqlx::query("UPDATE collab_sections SET state = ? WHERE id = ?")
        .bind(state)
        .bind(section_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let action = if is_owner {
        "owner_edited"
    } else {
        "edited_by_other"
    };
    audit::record(
        &mut tx,
        Change {
            draft_id,
            actor_id: &actor.id,
            action,
            target_id: section_id,
            from_hash: &section.content_hash,
            to_hash: &hash,
        },
    )
    .await?;
    advance(&mut tx, draft_id).await?;
    tx.commit().await.map_err(internal)?;
    Ok(json!({"ok": true, "state": state, "contentHash": hash}))
}

pub(crate) async fn confirm_section(
    db: &SqlitePool,
    actor: &Viewer,
    draft_id: &str,
    section_id: &str,
    input: &Value,
) -> ApiResult<Value> {
    let mut tx = db.begin().await.map_err(internal)?;
    let section = load_section(&mut tx, draft_id, section_id).await?;
    if !holds(&mut tx, &actor.id, &section.owner_position).await? {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Only this part's owner can confirm it",
        ));
    }
    ensure_based_on(&section, input)?;
    sqlx::query("UPDATE collab_sections SET state = 'confirmed' WHERE id = ?")
        .bind(section_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    audit::record(
        &mut tx,
        Change {
            draft_id,
            actor_id: &actor.id,
            action: "confirmed",
            target_id: section_id,
            from_hash: &section.content_hash,
            to_hash: &section.content_hash,
        },
    )
    .await?;
    advance(&mut tx, draft_id).await?;
    tx.commit().await.map_err(internal)?;
    Ok(json!({"ok": true}))
}

// Mental model: a tag is the owner's fact inside someone else's paragraph. Setting it rewrites that
// phrase in the paragraph; the paragraph keeps its own state, since the fact is the tag owner's.
pub(crate) async fn edit_tag(
    db: &SqlitePool,
    actor: &Viewer,
    draft_id: &str,
    tag_id: &str,
    input: &Value,
) -> ApiResult<Value> {
    let phrase = clean_text(input.get("phrase"), MAX_PHRASE)
        .ok_or_else(|| bad("The phrase needs text (up to 300 characters)"))?;
    let mut tx = db.begin().await.map_err(internal)?;
    let tag: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT t.section_id, t.label, t.phrase, t.owner_position FROM collab_tags t JOIN collab_sections s ON s.id = t.section_id WHERE t.id = ? AND s.draft_id = ?",
    )
    .bind(tag_id).bind(draft_id).fetch_optional(&mut *tx).await.map_err(internal)?;
    let (section_id, label, old_phrase, owner) =
        tag.ok_or(ApiError(StatusCode::NOT_FOUND, "Tag not found"))?;
    if !holds(&mut tx, &actor.id, &owner).await? {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Only this phrase's owner can set it; suggest changes by editing the paragraph instead",
        ));
    }
    let section = load_section(&mut tx, draft_id, &section_id).await?;
    let content = if section.content.contains(&old_phrase) {
        section.content.replace(&old_phrase, &phrase)
    } else if section.content.contains(&phrase) {
        section.content.clone()
    } else {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "The paragraph no longer contains this phrase; ask the paragraph's owner to restore it",
        ));
    };
    let hash = text_hash(&content);
    if hash != section.content_hash {
        write_revision(&mut tx, &section_id, &section, &content, &hash, &actor.id).await?;
    }
    sqlx::query("UPDATE collab_tags SET phrase = ?, state = 'confirmed' WHERE id = ?")
        .bind(&phrase)
        .bind(tag_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    if phrase != old_phrase {
        // The same kind of fact elsewhere in this email may now disagree: its owners re-check.
        sqlx::query("UPDATE collab_tags SET state = 'changed' WHERE id != ? AND label = ? AND section_id IN (SELECT id FROM collab_sections WHERE draft_id = ?)")
            .bind(tag_id).bind(&label).bind(draft_id).execute(&mut *tx).await.map_err(internal)?;
    }
    audit::record(
        &mut tx,
        Change {
            draft_id,
            actor_id: &actor.id,
            action: "tag_set",
            target_id: tag_id,
            from_hash: &text_hash(&old_phrase),
            to_hash: &text_hash(&phrase),
        },
    )
    .await?;
    advance(&mut tx, draft_id).await?;
    tx.commit().await.map_err(internal)?;
    Ok(json!({"ok": true}))
}

pub(crate) async fn answer_question(
    db: &SqlitePool,
    actor: &Viewer,
    draft_id: &str,
    question_id: &str,
    input: &Value,
) -> ApiResult<Value> {
    let answer = clean_text(input.get("answer"), MAX_ANSWER)
        .ok_or_else(|| bad("The answer needs text (up to 1000 characters)"))?;
    let mut tx = db.begin().await.map_err(internal)?;
    let owner: Option<(String,)> = sqlx::query_as(
        "SELECT s.owner_position FROM collab_questions q JOIN collab_sections s ON s.id = q.section_id WHERE q.id = ? AND s.draft_id = ?",
    )
    .bind(question_id).bind(draft_id).fetch_optional(&mut *tx).await.map_err(internal)?;
    let (owner,) = owner.ok_or(ApiError(StatusCode::NOT_FOUND, "Question not found"))?;
    if !holds(&mut tx, &actor.id, &owner).await? {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Only this part's owner can answer",
        ));
    }
    if stage_of(&mut tx, draft_id).await? == "queued" {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "This email was already sent",
        ));
    }
    sqlx::query("INSERT INTO collab_answers(question_id, answer, answered_by, answered_at) VALUES (?,?,?,?) ON CONFLICT(question_id) DO UPDATE SET answer = excluded.answer, answered_by = excluded.answered_by, answered_at = excluded.answered_at")
        .bind(question_id).bind(&answer).bind(&actor.id).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *tx).await.map_err(internal)?;
    audit::record(
        &mut tx,
        Change {
            draft_id,
            actor_id: &actor.id,
            action: "answered",
            target_id: question_id,
            from_hash: "",
            to_hash: &text_hash(&answer),
        },
    )
    .await?;
    advance(&mut tx, draft_id).await?;
    tx.commit().await.map_err(internal)?;
    Ok(json!({"ok": true}))
}

async fn load_section(tx: &mut Tx<'_>, draft_id: &str, section_id: &str) -> ApiResult<Section> {
    if stage_of(tx, draft_id).await? == "queued" {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "This email was already sent",
        ));
    }
    let row: Option<(String, i64, String, String)> = sqlx::query_as(
        "SELECT owner_position, revision, content, content_hash FROM collab_sections WHERE id = ? AND draft_id = ?",
    )
    .bind(section_id).bind(draft_id).fetch_optional(&mut **tx).await.map_err(internal)?;
    let (owner_position, revision, content, content_hash) =
        row.ok_or(ApiError(StatusCode::NOT_FOUND, "Section not found"))?;
    Ok(Section {
        owner_position,
        revision,
        content,
        content_hash,
    })
}

pub(crate) async fn ensure_involved(
    tx: &mut Tx<'_>,
    actor: &Viewer,
    draft_id: &str,
) -> ApiResult<()> {
    let (involved,): (i64,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM collab_drafts WHERE id = ?1 AND creator_id = ?2) \
         OR EXISTS(SELECT 1 FROM member_positions mp WHERE mp.member_id = ?2 AND (mp.position_slug IN (?3, ?4, ?5, ?6) \
            OR mp.position_slug IN (SELECT owner_position FROM collab_sections WHERE draft_id = ?1) \
            OR mp.position_slug IN (SELECT t.owner_position FROM collab_tags t JOIN collab_sections s ON s.id = t.section_id WHERE s.draft_id = ?1)))",
    )
    .bind(draft_id).bind(&actor.id).bind(SECRETARIAT).bind(PRESIDENT).bind(SENDER).bind(SENDER_FALLBACK)
    .fetch_one(&mut **tx).await.map_err(internal)?;
    if involved == 0 {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "You are not part of this email",
        ));
    }
    Ok(())
}

fn ensure_based_on(section: &Section, input: &Value) -> ApiResult<()> {
    if input.get("basedOnHash").and_then(Value::as_str) == Some(section.content_hash.as_str()) {
        return Ok(());
    }
    Err(ApiError(
        StatusCode::CONFLICT,
        "This part changed since you opened it; review the latest text",
    ))
}

async fn write_revision(
    tx: &mut Tx<'_>,
    section_id: &str,
    section: &Section,
    content: &str,
    hash: &str,
    author: &str,
) -> ApiResult<()> {
    let revision = section.revision + 1;
    sqlx::query("INSERT INTO collab_section_revisions(section_id, revision, content, content_hash, author_id, source, created_at) VALUES (?,?,?,?,?,'human',?)")
        .bind(section_id).bind(revision).bind(content).bind(hash).bind(author).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut **tx).await.map_err(internal)?;
    sqlx::query(
        "UPDATE collab_sections SET revision = ?, content = ?, content_hash = ? WHERE id = ?",
    )
    .bind(revision)
    .bind(content)
    .bind(hash)
    .bind(section_id)
    .execute(&mut **tx)
    .await
    .map_err(internal)?;
    Ok(())
}
