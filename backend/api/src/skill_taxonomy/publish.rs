//! Storing a compiled skill list as a new version. The AI output is untrusted input, so every
//! field is checked here: unique skill names, one skill per raw word, and bounded sizes.
//!
//! Module map (caller-first):
//!   publish_taxonomy    authorize → parse → store version, skills, aliases in one transaction
//!   └─ parse_taxonomy   JSON → skills with their raw aliases (first problem found is reported)
//!       └─ bounded      trimmed text within a length
use super::{access::can_compile, raw_skills::normalize_raw};
use crate::{ApiError, ApiResult, bad, identity::session::Viewer, internal};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use std::collections::HashSet;
use uuid::Uuid;

const MAX_SKILLS: usize = 500;
const MAX_ALIASES: usize = 5000;
const MAX_NAME: usize = 80;
const MAX_NOTE: usize = 120;

struct CompiledSkill {
    name: String,
    category: String,
    aliases: Vec<String>,
}

pub(crate) async fn publish_taxonomy(
    db: &SqlitePool,
    actor: &Viewer,
    input: &Value,
) -> ApiResult<Value> {
    if !can_compile(db, actor).await? {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Only Technology department officers can publish the skill list",
        ));
    }
    let skills = parse_taxonomy(input)?;
    let note = bounded(input.get("modelNote"), MAX_NOTE).unwrap_or_else(|| "local AI".to_owned());
    let version = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let mut tx = db.begin().await.map_err(internal)?;
    sqlx::query("INSERT INTO skill_taxonomy_versions(id, published_by, published_by_name, model_note, skill_count, published_at) VALUES (?,?,?,?,?,?)")
        .bind(&version).bind(&actor.id).bind(&actor.display_name).bind(&note).bind(skills.len() as i64).bind(&now)
        .execute(&mut *tx).await.map_err(internal)?;
    let mut alias_count = 0;
    for skill in &skills {
        sqlx::query("INSERT INTO skill_taxonomy_skills(version_id, name, category) VALUES (?,?,?)")
            .bind(&version)
            .bind(&skill.name)
            .bind(&skill.category)
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
        for alias in &skill.aliases {
            sqlx::query(
                "INSERT INTO skill_taxonomy_aliases(version_id, raw, skill_name) VALUES (?,?,?)",
            )
            .bind(&version)
            .bind(alias)
            .bind(&skill.name)
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
            alias_count += 1;
        }
    }
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "skill_taxonomy",
        operation = "publish",
        skills = skills.len(),
        aliases = alias_count,
        "skill_taxonomy.published"
    );
    Ok(json!({"versionId": version, "skillCount": skills.len(), "aliasCount": alias_count}))
}

fn parse_taxonomy(input: &Value) -> ApiResult<Vec<CompiledSkill>> {
    let entries = input
        .get("skills")
        .and_then(Value::as_array)
        .ok_or_else(|| bad("The skill list is missing"))?;
    if entries.is_empty() || entries.len() > MAX_SKILLS {
        return Err(bad("The skill list must have between 1 and 500 skills"));
    }
    let mut names = HashSet::new();
    let mut raws = HashSet::new();
    let mut skills = Vec::with_capacity(entries.len());
    for entry in entries {
        let name = bounded(entry.get("name"), MAX_NAME)
            .ok_or_else(|| bad("Every skill needs a name of up to 80 characters"))?;
        if !names.insert(name.to_lowercase()) {
            return Err(bad("Skill names must be unique"));
        }
        let category =
            bounded(entry.get("category"), MAX_NAME).unwrap_or_else(|| "Other".to_owned());
        let mut aliases: Vec<String> = entry
            .get("aliases")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(normalize_raw)
            .filter(|alias| !alias.is_empty() && alias.chars().count() <= MAX_NAME)
            .collect();
        aliases.push(normalize_raw(&name));
        aliases.sort();
        aliases.dedup();
        for alias in &aliases {
            if !raws.insert(alias.clone()) {
                return Err(bad("Each raw skill word may belong to only one skill"));
            }
        }
        skills.push(CompiledSkill {
            name,
            category,
            aliases,
        });
    }
    if raws.len() > MAX_ALIASES {
        return Err(bad("The skill list has too many raw words"));
    }
    Ok(skills)
}

fn bounded(value: Option<&Value>, max: usize) -> Option<String> {
    let text = value?
        .as_str()?
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!text.is_empty() && text.chars().count() <= max).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::parse_taxonomy;
    use serde_json::json;

    #[test]
    fn a_raw_word_may_map_to_only_one_skill() {
        let input = json!({"skills": [
            {"name": "Web scraping and automation", "category": "Engineering", "aliases": ["BeautifulSoup", "playwright"]},
            {"name": "Browser testing", "category": "Engineering", "aliases": ["Playwright"]},
        ]});
        assert!(parse_taxonomy(&input).is_err());
    }

    #[test]
    fn aliases_are_normalized_and_include_the_skill_name() {
        let input = json!({"skills": [{"name": "Deep learning", "category": "ML", "aliases": ["  PyTorch ", "pytorch", "TensorFlow"]}]});
        let skills = parse_taxonomy(&input).unwrap();
        assert_eq!(
            skills[0].aliases,
            vec!["deep learning", "pytorch", "tensorflow"]
        );
    }
}
