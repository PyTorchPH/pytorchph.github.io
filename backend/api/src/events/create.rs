//! Creating an organization event, optionally competitive with points per place.
//!
//! Module map (caller-first):
//!   create_event                          validates, then stores the event and its place points
//!   ├─ ensure_valid_event                 title, category, start time, competition shape, parent rule
//!   │   ├─ is_valid_title
//!   │   ├─ is_valid_category
//!   │   ├─ parse_event_start
//!   │   ├─ ensure_competition_shape
//!   │   │   ├─ is_known_entrant_kind
//!   │   │   └─ are_valid_place_points
//!   │   └─ is_mini_contest
//!   ├─ ensure_parent_accepts_mini_contest a mini contest hangs off a top-level talk or workshop
//!   ├─ insert_event
//!   └─ insert_place_points
use super::records::{Created, Tx, audit};
use crate::scoring;
use crate::{ApiResult, AppState, bad, check_origin, identity::session, internal};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Publication {
    #[serde(default)]
    is_public: bool,
    #[serde(default)]
    is_demo: bool,
    #[serde(default)]
    topic: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    venue: String,
    #[serde(default)]
    registration_url: String,
    #[serde(default)]
    series: String,
}

pub async fn create_public_event(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut input): Json<serde_json::Value>,
) -> ApiResult<(StatusCode, Json<Created>)> {
    check_origin(&state, &headers)?;
    session::require_officer(&state, &headers).await?;
    let object = input
        .as_object_mut()
        .ok_or_else(|| malformed_public_input(bad("Invalid event body")))?;
    let publication: Publication = object
        .remove("publication")
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| malformed_public_input(bad("Invalid event publication")))?
        .unwrap_or_default();
    let event = serde_json::from_value(input)
        .map_err(|_| malformed_public_input(bad("Invalid event body")))?;
    create_with_publication(state, headers, event, publication, true)
        .await
        .map_err(malformed_public_input)
}

fn malformed_public_input(mut error: crate::ApiError) -> crate::ApiError {
    if error.0 == StatusCode::UNPROCESSABLE_ENTITY {
        error.0 = StatusCode::BAD_REQUEST;
    }
    error
}

pub async fn update_publication(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(event_id): Path<String>,
    Json(input): Json<serde_json::Value>,
) -> ApiResult<Json<serde_json::Value>> {
    check_origin(&state, &headers)?;
    let actor = session::require_officer(&state, &headers).await?;
    let publication: Publication = serde_json::from_value(input)
        .map_err(|_| malformed_public_input(bad("Invalid event publication")))?;
    ensure_valid_publication(&publication).map_err(malformed_public_input)?;
    let mut tx = state.db.begin().await.map_err(internal)?;
    let existing: Option<(String,bool,bool)> = sqlx::query_as("SELECT COALESCE(e.created_by,''),COALESCE(p.is_public,0),COALESCE(p.is_demo,0) FROM events e LEFT JOIN event_publication p ON p.event_id=e.id WHERE e.id=?")
        .bind(&event_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(internal)?;
    let (owner, was_public, was_demo) =
        existing.ok_or(crate::ApiError(StatusCode::NOT_FOUND, "Event not found"))?;
    super::publication_access::require_update(
        &mut tx,
        &actor,
        &owner,
        was_public,
        was_demo,
        publication.is_public,
        publication.is_demo,
    )
    .await?;
    sqlx::query("INSERT INTO event_publication(event_id,is_public,is_demo,topic,venue,registration_url,series,description) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET is_public=excluded.is_public,is_demo=excluded.is_demo,topic=excluded.topic,venue=excluded.venue,registration_url=excluded.registration_url,series=excluded.series,description=excluded.description")
        .bind(&event_id).bind(publication.is_public).bind(publication.is_demo)
        .bind(publication.topic.trim()).bind(publication.venue.trim())
        .bind(publication.registration_url.trim()).bind(publication.series.trim())
        .bind(publication.description.trim())
        .execute(&mut *tx).await.map_err(internal)?;
    audit(
        &mut tx,
        &actor.id,
        "event.publication_updated",
        &event_id,
        0,
    )
    .await?;
    tx.commit().await.map_err(internal)?;
    Ok(Json(serde_json::json!({"ok":true})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventSkillTag {
    pub skill_slug: String,
    pub allocation_bps: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewEvent {
    pub title: String,
    pub category: String,
    pub starts_at: String,
    pub parent_id: Option<String>,
    pub entrant_kind: Option<String>,
    pub place_points: Option<Vec<i64>>,
    pub skill_tags: Vec<EventSkillTag>,
    pub weight_milli: Option<i64>,
    pub weight_reason: Option<String>,
}

// Mental model: an officer describes an event; everything is validated before the
// transaction, then the event row, its place points and an audit row land together.
#[cfg(test)]
pub async fn create_event(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<NewEvent>,
) -> ApiResult<(StatusCode, Json<Created>)> {
    create_with_publication(state, headers, input, Publication::default(), false).await
}

async fn create_with_publication(
    state: Arc<AppState>,
    headers: HeaderMap,
    input: NewEvent,
    publication: Publication,
    enforce_positions: bool,
) -> ApiResult<(StatusCode, Json<Created>)> {
    check_origin(&state, &headers)?;
    let actor = session::require_officer(&state, &headers).await?;
    let title = input.title.trim();
    let starts_at = ensure_valid_event(title, &input)?;
    ensure_valid_publication(&publication)?;
    let mut tx = state.db.begin().await.map_err(internal)?;
    if enforce_positions {
        super::publication_access::require_create(&mut tx, &actor, publication.is_public).await?;
    }
    if let Some(parent_id) = &input.parent_id {
        ensure_parent_accepts_mini_contest(&mut tx, parent_id).await?;
    }
    let id = Uuid::new_v4().to_string();
    ensure_known_skills(&mut tx, &input.skill_tags).await?;
    let tags: Vec<(String, i64)> = input
        .skill_tags
        .iter()
        .map(|tag| (tag.skill_slug.clone(), tag.allocation_bps))
        .collect();
    let suggestion = scoring::suggested_weight(&mut tx, &input.category, &tags).await?;
    let proposal = if let Some((version, _)) = suggestion {
        scoring::proposed_place_points(&mut tx, version, &input.category).await?
    } else {
        None
    };
    let selected_points = input
        .entrant_kind
        .as_ref()
        .and_then(|_| input.place_points.clone().or_else(|| proposal.clone()));
    if input.entrant_kind.is_some() && selected_points.is_none() {
        return Err(bad(
            "Placement schedule unavailable; organizer points required",
        ));
    }
    let place_override =
        input.place_points.is_some() && proposal.as_ref() != input.place_points.as_ref();
    let place_reason = input.weight_reason.as_deref().unwrap_or("").trim();
    if place_override && proposal.is_some() && !(4..=500).contains(&place_reason.len()) {
        return Err(bad("Placement override reason required"));
    }
    let (weight, reason) = match (input.weight_milli, suggestion) {
        (Some(weight), _) => (weight, input.weight_reason.as_deref().unwrap_or("")),
        (None, Some((_, weight))) => (weight, "published_model"),
        (None, None) => {
            return Err(bad(
                "Model suggestion unavailable; organizer weight required",
            ));
        }
    };
    if !(1..=10000).contains(&weight)
        || (input.weight_milli.is_some() && !(4..=500).contains(&reason.trim().len()))
    {
        return Err(bad("Invalid event weight or reason"));
    }
    insert_event(
        &mut tx,
        &id,
        title,
        &starts_at,
        &input,
        selected_points.as_deref(),
        &actor.id,
    )
    .await?;
    sqlx::query("INSERT INTO event_publication(event_id,is_public,is_demo,topic,venue,registration_url,series,description) VALUES (?,?,?,?,?,?,?,?)")
        .bind(&id).bind(publication.is_public).bind(publication.is_demo)
        .bind(publication.topic.trim()).bind(publication.venue.trim())
        .bind(publication.registration_url.trim()).bind(publication.series.trim())
        .bind(publication.description.trim())
        .execute(&mut *tx).await.map_err(internal)?;
    sqlx::query("INSERT INTO event_scoring(event_id,weight_milli,model_version,selected_by,decision_reason,selected_at,proposed_place_points_json,selected_place_points_json,placement_override_reason) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(&id).bind(weight).bind(suggestion.map(|(version,_)|version)).bind(&actor.id)
        .bind(reason).bind(Utc::now().to_rfc3339())
        .bind(proposal.as_ref().map(|points| serde_json::to_string(points).expect("serializable points")))
        .bind(selected_points.as_ref().map(|points| serde_json::to_string(points).expect("serializable points")))
        .bind(place_override.then_some(if proposal.is_some() { place_reason } else { "manual_no_model" }))
        .execute(&mut *tx).await.map_err(internal)?;
    for tag in &input.skill_tags {
        sqlx::query(
            "INSERT INTO event_skill_tags(event_id,skill_slug,allocation_bps) VALUES (?,?,?)",
        )
        .bind(&id)
        .bind(&tag.skill_slug)
        .bind(tag.allocation_bps)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    }
    if let Some(points) = &selected_points {
        insert_place_points(&mut tx, &id, points).await?;
    }
    audit(&mut tx, &actor.id, "event.created", &id, 0).await?;
    tx.commit().await.map_err(internal)?;
    Ok((StatusCode::CREATED, Json(Created::first(id))))
}

/// Returns the normalized UTC start time once the request describes a valid event.
fn ensure_valid_publication(publication: &Publication) -> ApiResult<()> {
    if publication.description.chars().count() > 2000
        || publication
            .description
            .chars()
            .any(|value| value.is_control() && value != '\n')
        || (publication.is_public && publication.description.trim().is_empty())
    {
        return Err(bad(
            "Public events require a description of at most 2000 characters",
        ));
    }
    for (value, maximum) in [
        (&publication.topic, 500),
        (&publication.venue, 300),
        (&publication.registration_url, 2000),
        (&publication.series, 200),
    ] {
        if value.chars().count() > maximum || value.chars().any(char::is_control) {
            return Err(bad("Invalid event publication text"));
        }
    }
    let url = publication.registration_url.trim();
    if publication.is_demo && !url.is_empty() {
        return Err(bad("Demo events cannot have registration links"));
    }
    if !url.is_empty() {
        let parsed = reqwest::Url::parse(url).map_err(|_| bad("Invalid registration URL"))?;
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err(bad("Registration URL must use HTTPS without credentials"));
        }
    }
    Ok(())
}

/// Returns the normalized UTC start time once the request describes a valid event.
fn ensure_valid_event(title: &str, input: &NewEvent) -> ApiResult<String> {
    if !is_valid_title(title) || !is_valid_category(&input.category) {
        return Err(bad("Invalid event title or category"));
    }
    let starts_at = parse_event_start(&input.starts_at)?;
    ensure_competition_shape(input)?;
    let unique: HashSet<&str> = input
        .skill_tags
        .iter()
        .map(|tag| tag.skill_slug.as_str())
        .collect();
    if input.skill_tags.is_empty()
        || unique.len() != input.skill_tags.len()
        || input.skill_tags.iter().any(|tag| tag.allocation_bps <= 0)
        || input
            .skill_tags
            .iter()
            .map(|tag| tag.allocation_bps)
            .sum::<i64>()
            != 10000
    {
        return Err(bad("Event skill allocations must total 10000 basis points"));
    }
    if is_mini_contest(&input.category) != input.parent_id.is_some() {
        return Err(bad("Mini contest requires parent event"));
    }
    Ok(starts_at)
}

async fn ensure_known_skills(tx: &mut Tx<'_>, tags: &[EventSkillTag]) -> ApiResult<()> {
    for tag in tags {
        let known: Option<(String,)> = sqlx::query_as("SELECT slug FROM skills WHERE slug=?")
            .bind(&tag.skill_slug)
            .fetch_optional(&mut **tx)
            .await
            .map_err(internal)?;
        if known.is_none() {
            return Err(bad("Unknown event skill"));
        }
    }
    Ok(())
}

#[inline]
fn is_valid_title(title: &str) -> bool {
    (3..=200).contains(&title.len())
}

#[inline]
fn is_valid_category(value: &str) -> bool {
    matches!(
        value,
        "talk" | "workshop" | "hackathon" | "competitive" | "mini_contest"
    )
}

fn parse_event_start(value: &str) -> ApiResult<String> {
    Ok(DateTime::parse_from_rfc3339(value)
        .map_err(|_| bad("Invalid event start"))?
        .with_timezone(&Utc)
        .to_rfc3339())
}

// Competitive events carry an entrant kind; place points may come from the model.
fn ensure_competition_shape(input: &NewEvent) -> ApiResult<()> {
    let category_requires_competition = !matches!(input.category.as_str(), "talk" | "workshop");
    match (input.entrant_kind.as_deref(), input.place_points.as_deref()) {
        (None, None) if !category_requires_competition => Ok(()),
        (Some(kind), None)
            if is_known_entrant_kind(Some(kind)) && category_requires_competition =>
        {
            Ok(())
        }
        (Some(kind), Some(points))
            if is_known_entrant_kind(Some(kind)) && are_valid_place_points(points) =>
        {
            Ok(())
        }
        _ => Err(bad("Invalid competition entrant kind or placement points")),
    }
}

#[inline]
fn is_known_entrant_kind(kind: Option<&str>) -> bool {
    matches!(kind, Some("team" | "individual"))
}

#[inline]
fn are_valid_place_points(points: &[i64]) -> bool {
    !points.is_empty()
        && points.len() <= 100
        && points.iter().all(|value| *value >= 0)
        && points.windows(2).all(|pair| pair[0] >= pair[1])
}

#[inline]
fn is_mini_contest(category: &str) -> bool {
    category == "mini_contest"
}

async fn ensure_parent_accepts_mini_contest(tx: &mut Tx<'_>, parent_id: &str) -> ApiResult<()> {
    let parent: Option<(String,)> =
        sqlx::query_as("SELECT category FROM events WHERE id = ? AND parent_id IS NULL")
            .bind(parent_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(internal)?;
    if !matches!(
        parent.as_ref().map(|row| row.0.as_str()),
        Some("talk" | "workshop")
    ) {
        return Err(bad("Mini contest parent must be a talk or workshop"));
    }
    Ok(())
}

async fn insert_event(
    tx: &mut Tx<'_>,
    id: &str,
    title: &str,
    starts_at: &str,
    input: &NewEvent,
    points: Option<&[i64]>,
    actor_id: &str,
) -> ApiResult<()> {
    let competitive = points.is_some();
    let last_place = points.map(|items| items.len() as i64);
    sqlx::query("INSERT INTO events(id,parent_id,title,category,starts_at,competitive,entrant_kind,last_place,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(id).bind(&input.parent_id).bind(title).bind(&input.category).bind(starts_at)
        .bind(competitive as i64).bind(&input.entrant_kind).bind(last_place)
        .bind(actor_id).bind(Utc::now().to_rfc3339()).execute(&mut **tx).await.map_err(internal)?;
    Ok(())
}

// Place 1 gets the first value, place 2 the second, and so on.
async fn insert_place_points(tx: &mut Tx<'_>, event_id: &str, points: &[i64]) -> ApiResult<()> {
    for (index, value) in points.iter().enumerate() {
        sqlx::query("INSERT INTO place_points(event_id,place,points) VALUES (?,?,?)")
            .bind(event_id)
            .bind((index + 1) as i64)
            .bind(value)
            .execute(&mut **tx)
            .await
            .map_err(internal)?;
    }
    Ok(())
}
