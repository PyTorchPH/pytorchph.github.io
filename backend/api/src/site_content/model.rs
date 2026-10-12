//! Bounded plain-text content and HTTPS/asset URLs; never executable markup.
use crate::{ApiResult, bad};
use serde_json::Value;
use std::collections::HashSet;

const COLLECTIONS: [&str; 4] = ["leadership", "events", "chapters", "articles"];

pub(crate) fn dynamic_document(stored: &Value) -> ApiResult<Value> {
    let source = stored.as_object().ok_or(bad("Expected a content object"))?;
    let document = Value::Object(
        COLLECTIONS
            .iter()
            .map(|key| {
                source
                    .get(*key)
                    .cloned()
                    .map(|value| ((*key).to_owned(), value))
                    .ok_or(bad("Missing dynamic content collection"))
            })
            .collect::<ApiResult<_>>()?,
    );
    validate(&document)?;
    Ok(document)
}

// Mental model: validate the document shape, then each collection's exact fields and semantics.
pub(crate) fn validate(document: &Value) -> ApiResult<()> {
    fields(document, &COLLECTIONS)?;
    if document.to_string().len() > 128 * 1024 {
        return Err(bad("Website content exceeds 128 KiB"));
    }
    for (key, columns) in [
        (
            "leadership",
            &[
                "id",
                "name",
                "title",
                "affiliation",
                "group",
                "department",
                "photoUrl",
            ][..],
        ),
        (
            "events",
            &[
                "id",
                "title",
                "eventType",
                "topic",
                "startsAt",
                "dateStatus",
                "scheduleLabel",
                "venue",
                "registrationUrl",
                "series",
                "modules",
                "photoUrl",
            ][..],
        ),
        (
            "chapters",
            &[
                "id",
                "university",
                "chapter",
                "island",
                "status",
                "photoUrl",
            ][..],
        ),
        (
            "articles",
            &[
                "id",
                "title",
                "kind",
                "publishedAt",
                "eventDate",
                "venue",
                "speakers",
                "topics",
                "highlights",
                "takeaways",
                "acknowledgments",
                "photoUrl",
            ][..],
        ),
    ] {
        let rows = document[key]
            .as_array()
            .ok_or(bad("Content collections must be arrays"))?;
        if rows.len() > 100 {
            return Err(bad("At most 100 entries per collection"));
        }
        let mut ids = HashSet::new();
        for row in rows {
            texts(row, columns)?;
            let id = text(&row["id"])?;
            if id.is_empty()
                || id.len() > 80
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                || !ids.insert(id)
            {
                return Err(bad("Entry IDs must be nonempty and unique"));
            }
            for field in ["photoUrl", "registrationUrl"] {
                if let Some(value) = row.get(field) {
                    url(value)?;
                }
            }
            match key {
                "leadership" => choice(&row["group"], &["ambassador", "core", "department"])?,
                "chapters" => choice(&row["island"], &["Luzon", "Visayas", "Mindanao"])?,
                "events" => {
                    choice(
                        &row["dateStatus"],
                        &["confirmed", "tentative", "coming_soon"],
                    )?;
                    date(&row["startsAt"], row["dateStatus"] == "confirmed")?;
                }
                "articles" => {
                    choice(&row["kind"], &["news", "recap"])?;
                    date(&row["publishedAt"], true)?;
                    date(&row["eventDate"], row["kind"] == "recap")?;
                }
                _ => {}
            }
        }
    }
    Ok(())
}

fn texts(value: &Value, keys: &[&str]) -> ApiResult<()> {
    fields(value, keys)?;
    for key in keys {
        text(&value[*key])?;
    }
    Ok(())
}

fn fields(value: &Value, keys: &[&str]) -> ApiResult<()> {
    let object = value.as_object().ok_or(bad("Expected a content object"))?;
    if object.len() != keys.len() || !object.keys().all(|key| keys.contains(&key.as_str())) {
        return Err(bad("Missing or unsupported content fields"));
    }
    Ok(())
}

fn text(value: &Value) -> ApiResult<&str> {
    let s = value.as_str().ok_or(bad("Content values must be text"))?;
    if s.len() > 8000 || s.contains('\0') {
        return Err(bad("Text exceeds 8000 bytes or contains NUL"));
    }
    Ok(s)
}

fn choice(value: &Value, values: &[&str]) -> ApiResult<()> {
    if !values.contains(&text(value)?) {
        return Err(bad("Unsupported content status or group"));
    }
    Ok(())
}

fn url(value: &Value) -> ApiResult<()> {
    let s = text(value)?;
    if s.is_empty() {
        return Ok(());
    }
    if s.starts_with("/assets/") && !s.contains("..") && !s.contains(['\\', '?', '#']) {
        return Ok(());
    }
    let parsed =
        reqwest::Url::parse(s).map_err(|_| bad("Use HTTPS URLs or local /assets/ paths"))?;
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(bad("Only HTTPS URLs without credentials are allowed"));
    }
    Ok(())
}

fn date(value: &Value, required: bool) -> ApiResult<()> {
    let s = text(value)?;
    if s.is_empty() && !required {
        return Ok(());
    }
    if chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_err()
        && chrono::DateTime::parse_from_rfc3339(s).is_err()
    {
        return Err(bad("Use a YYYY-MM-DD date or RFC3339 timestamp"));
    }
    Ok(())
}
