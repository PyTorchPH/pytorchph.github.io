//! What a collaborative draft is made of, how submitted parts are validated, and hashing.
//!
//! Module map (caller-first):
//!   parse_new_draft      creator's JSON → NewDraft (sections, tags, questions), every rule checked
//!   ├─ parse_section     content, owner position, tags inside it, questions for its owner
//!   │   └─ parse_tag     label, phrase that must appear in the section, owner position
//!   └─ clean_text        trimmed, control characters removed, length-bounded
//!   text_hash            SHA-256 of a section's text (the cache key)
//!   assembled            ordered sections → the full body, and the hash approvals bind to
use crate::{ApiResult, bad};
use serde_json::Value;
use sha2::{Digest, Sha256};

const MAX_SECTIONS: usize = 30;
const MAX_SECTION: usize = 4000;
const MAX_TAGS_PER_SECTION: usize = 20;
const MAX_QUESTIONS_PER_SECTION: usize = 10;
const MAX_TITLE: usize = 160;
const MAX_SUBJECT: usize = 200;
const MAX_PHRASE: usize = 300;
const MAX_PROMPT: usize = 300;
pub(crate) const MAX_ANSWER: usize = 1000;
pub(crate) const TAG_LABELS: [&str; 10] = [
    "date", "time", "venue", "budget", "speaker", "program", "partner", "link", "contact", "other",
];

pub(crate) struct NewTag {
    pub(crate) label: String,
    pub(crate) phrase: String,
    pub(crate) owner_position: String,
}

pub(crate) struct NewSection {
    pub(crate) content: String,
    pub(crate) owner_position: String,
    pub(crate) tags: Vec<NewTag>,
    pub(crate) questions: Vec<String>,
}

pub(crate) struct NewDraft {
    pub(crate) title: String,
    pub(crate) subject: String,
    pub(crate) recipients: Vec<String>,
    pub(crate) mode: &'static str,
    pub(crate) sections: Vec<NewSection>,
}

// Mental model: the whole draft is checked before anything is stored; AI output arrives through
// the creator's client and is treated exactly like typed text (plain text only, bounded).
pub(crate) fn parse_new_draft(input: &Value) -> ApiResult<NewDraft> {
    let sections: Vec<NewSection> = input
        .get("sections")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(parse_section)
        .collect::<ApiResult<_>>()?;
    if sections.is_empty() || sections.len() > MAX_SECTIONS {
        return Err(bad("An email needs between 1 and 30 sections"));
    }
    let recipients: Vec<String> = input
        .get("recipients")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|address| address.trim().to_lowercase())
        .filter(|address| !address.is_empty())
        .collect();
    Ok(NewDraft {
        title: clean_text(input.get("title"), MAX_TITLE)
            .ok_or_else(|| bad("Give the email a title"))?,
        subject: clean_text(input.get("subject"), MAX_SUBJECT)
            .ok_or_else(|| bad("Give the email a subject"))?,
        recipients,
        mode: if input.get("mode").and_then(Value::as_str) == Some("ai") {
            "ai"
        } else {
            "manual"
        },
        sections,
    })
}

fn parse_section(section: &Value) -> ApiResult<NewSection> {
    let content = clean_text(section.get("content"), MAX_SECTION)
        .ok_or_else(|| bad("Every section needs text (up to 4000 characters)"))?;
    let owner_position = position_slug(section.get("ownerPosition"))
        .ok_or_else(|| bad("Every section needs an owner position"))?;
    let tags: Vec<NewTag> = section
        .get("tags")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|tag| parse_tag(tag, &content))
        .collect::<ApiResult<_>>()?;
    let questions: Vec<String> = section
        .get("questions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|prompt| clean_text(Some(prompt), MAX_PROMPT))
        .collect();
    if tags.len() > MAX_TAGS_PER_SECTION || questions.len() > MAX_QUESTIONS_PER_SECTION {
        return Err(bad("A section can have at most 20 tags and 10 questions"));
    }
    Ok(NewSection {
        content,
        owner_position,
        tags,
        questions,
    })
}

fn parse_tag(tag: &Value, content: &str) -> ApiResult<NewTag> {
    let label = tag
        .get("label")
        .and_then(Value::as_str)
        .filter(|label| TAG_LABELS.contains(label))
        .ok_or_else(|| bad("Unknown tag label"))?;
    let phrase = clean_text(tag.get("phrase"), MAX_PHRASE)
        .ok_or_else(|| bad("Every tag needs its phrase"))?;
    if !content.contains(&phrase) {
        return Err(bad("A tagged phrase must appear in its section"));
    }
    let owner_position = position_slug(tag.get("ownerPosition"))
        .ok_or_else(|| bad("Every tag needs an owner position"))?;
    Ok(NewTag {
        label: label.to_owned(),
        phrase,
        owner_position,
    })
}

fn position_slug(value: Option<&Value>) -> Option<String> {
    value?
        .as_str()
        .filter(|slug| {
            !slug.is_empty()
                && slug.len() <= 60
                && slug.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
        })
        .map(str::to_owned)
}

/// Plain text only: control characters (other than newlines and tabs) are removed.
pub(crate) fn clean_text(value: Option<&Value>, max: usize) -> Option<String> {
    let text: String = value?
        .as_str()?
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect();
    let text = text.trim().to_owned();
    (!text.is_empty() && text.chars().count() <= max).then_some(text)
}

pub(crate) fn text_hash(text: &str) -> String {
    hex::encode(Sha256::digest(text.as_bytes()))
}

/// The full body (sections in order) and the hash approvals bind to (subject, recipients, parts).
pub(crate) fn assembled(
    subject: &str,
    recipients_json: &str,
    sections: &[(String, String)],
) -> (String, String) {
    let body = sections
        .iter()
        .map(|(content, _)| content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let mut hasher = Sha256::new();
    hasher.update(subject.as_bytes());
    hasher.update(recipients_json.as_bytes());
    for (_, hash) in sections {
        hasher.update(hash.as_bytes());
    }
    (body, hex::encode(hasher.finalize()))
}
