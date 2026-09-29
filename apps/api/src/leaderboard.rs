//! Season leaderboard and member overview computed from the point ledger, pending
//! evidence, rank tiers and verified skills. Members with an active integrity
//! sanction are excluded from ranking until an officer restores them.
use crate::{ApiResult, auth::Viewer, integrity::member_label, internal};
use chrono::{DateTime, Datelike, FixedOffset, Utc};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use std::collections::{BTreeSet, HashMap};

const MAX_PAGE_SIZE: usize = 100;
const ACTIVITY_WEEKS: i64 = 12;

struct Season {
    slug: String,
    label: String,
    starts_at: String,
    ends_at: String,
    start: DateTime<FixedOffset>,
    end: DateTime<FixedOffset>,
}

impl Season {
    fn state(&self, now: DateTime<Utc>) -> &'static str {
        if now < self.start {
            "upcoming"
        } else if now >= self.end {
            "completed"
        } else {
            "active"
        }
    }

    fn contains(&self, at: DateTime<FixedOffset>) -> bool {
        at >= self.start && at < self.end
    }
}

#[derive(Clone)]
struct Entry {
    member_id: String,
    label: String,
    verified: i64,
    pending: i64,
    streak: i64,
    skills: Vec<String>,
}

impl Entry {
    fn points(&self) -> i64 {
        self.verified + self.pending
    }
}

fn parse(at: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(at).ok()
}

async fn seasons(db: &SqlitePool) -> ApiResult<Vec<Season>> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT slug, label, starts_at, ends_at FROM leaderboard_seasons ORDER BY starts_at DESC",
    )
    .fetch_all(db)
    .await
    .map_err(internal)?;
    Ok(rows
        .into_iter()
        .filter_map(|(slug, label, starts_at, ends_at)| {
            Some(Season {
                start: parse(&starts_at)?,
                end: parse(&ends_at)?,
                slug,
                label,
                starts_at,
                ends_at,
            })
        })
        .collect())
}

fn select_season<'a>(
    all: &'a [Season],
    slug: Option<&str>,
    now: DateTime<Utc>,
) -> Option<&'a Season> {
    slug.and_then(|wanted| all.iter().find(|season| season.slug == wanted))
        .or_else(|| all.iter().find(|season| season.state(now) == "active"))
        .or_else(|| all.first())
}

fn week_index(at: DateTime<FixedOffset>) -> i64 {
    let date = at.with_timezone(&Utc).date_naive();
    i64::from(date.iso_week().year()) * 53 + i64::from(date.iso_week().week())
}

// Consecutive ISO weeks with earned points, ending this week or last week.
fn streak(weeks: &BTreeSet<i64>, now: DateTime<Utc>) -> i64 {
    let current = week_index(now.fixed_offset());
    let mut week = if weeks.contains(&current) {
        current
    } else {
        current - 1
    };
    let mut count = 0;
    while weeks.contains(&week) {
        count += 1;
        week -= 1;
    }
    count
}

async fn tiers(db: &SqlitePool) -> ApiResult<Vec<(String, i64)>> {
    sqlx::query_as("SELECT tier, min_points FROM rank_tiers ORDER BY min_points")
        .fetch_all(db)
        .await
        .map_err(internal)
}

// Tier by threshold; division III..I splits the tier's band into thirds.
fn tier_of(tiers: &[(String, i64)], points: i64) -> (String, &'static str) {
    let index = tiers
        .iter()
        .rposition(|(_, min)| points >= *min)
        .unwrap_or(0);
    let Some((tier, min)) = tiers.get(index) else {
        return ("Unranked".into(), "III");
    };
    let band = tiers
        .get(index + 1)
        .map_or(1000, |(_, next)| next - min)
        .max(3);
    let division = match (points - min) * 3 / band {
        0 => "III",
        1 => "II",
        _ => "I",
    };
    (tier.clone(), division)
}

async fn participation_units(db: &SqlitePool) -> ApiResult<i64> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT l.units FROM point_rubric_levels l JOIN point_rubric_versions v ON v.version = l.rubric_version \
         WHERE l.level = 'participation' AND v.published_at IS NOT NULL ORDER BY l.rubric_version DESC LIMIT 1",
    )
    .fetch_optional(db)
    .await
    .map_err(internal)?;
    Ok(row.map_or(1, |(units,)| units))
}

/// Ranked entries for a season, ordered by total points.
async fn standings(
    db: &SqlitePool,
    season: Option<&Season>,
    now: DateTime<Utc>,
) -> ApiResult<Vec<Entry>> {
    let members: Vec<(String, String, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT m.id, m.public_handle, \
                (SELECT json_extract(value_json, '$.username') FROM portal_state WHERE scope = m.id AND state_key = '/api/member/leaderboard-identity'), \
                (SELECT json_extract(value_json, '$.anonymousRanking') FROM portal_state WHERE scope = m.id AND state_key = '/api/member/privacy') \
         FROM members m WHERE m.role != 'pending' \
         AND NOT EXISTS (SELECT 1 FROM leaderboard_sanctions s WHERE s.member_id = m.id AND s.lifted_at IS NULL)",
    )
    .fetch_all(db)
    .await
    .map_err(internal)?;
    let ledger: Vec<(String, i64, String)> =
        sqlx::query_as("SELECT member_id, delta, created_at FROM point_ledger")
            .fetch_all(db)
            .await
            .map_err(internal)?;
    let pending: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT member_id, source, created_at FROM evidence_claims WHERE status = 'pending'",
    )
    .fetch_all(db)
    .await
    .map_err(internal)?;
    let skills: Vec<(String, String)> = sqlx::query_as(
        "SELECT ms.member_id, s.label FROM member_skills ms JOIN skills s ON s.slug = ms.skill_slug ORDER BY s.label",
    )
    .fetch_all(db)
    .await
    .map_err(internal)?;
    let units = participation_units(db).await?;
    let in_season =
        |at: &str| parse(at).is_some_and(|at| season.is_none_or(|season| season.contains(at)));

    let mut verified: HashMap<&str, i64> = HashMap::new();
    let mut weeks: HashMap<&str, BTreeSet<i64>> = HashMap::new();
    for (member, delta, at) in &ledger {
        if in_season(at) {
            *verified.entry(member.as_str()).or_default() += delta;
        }
        if let (true, Some(at)) = (*delta > 0, parse(at)) {
            weeks
                .entry(member.as_str())
                .or_default()
                .insert(week_index(at));
        }
    }
    let mut provisional: HashMap<&str, i64> = HashMap::new();
    for (member, source, at) in &pending {
        if in_season(at) {
            let weight = if source == "github" { 2 } else { 3 };
            *provisional.entry(member.as_str()).or_default() += units * 10 * weight;
        }
    }
    let mut member_skills: HashMap<&str, Vec<String>> = HashMap::new();
    for (member, label) in &skills {
        member_skills
            .entry(member.as_str())
            .or_default()
            .push(label.clone());
    }

    let mut entries: Vec<Entry> = members
        .iter()
        .map(|(id, handle, username, anonymous)| Entry {
            member_id: id.clone(),
            label: if anonymous.unwrap_or(0) == 1 {
                member_label(id)
            } else {
                username
                    .clone()
                    .filter(|name| !name.is_empty())
                    .unwrap_or_else(|| handle.clone())
            },
            verified: verified.get(id.as_str()).copied().unwrap_or(0).max(0),
            pending: provisional.get(id.as_str()).copied().unwrap_or(0),
            streak: weeks.get(id.as_str()).map_or(0, |set| streak(set, now)),
            skills: member_skills.remove(id.as_str()).unwrap_or_default(),
        })
        .collect();
    entries.sort_by(|a, b| {
        b.points()
            .cmp(&a.points())
            .then(b.verified.cmp(&a.verified))
            .then(a.label.cmp(&b.label))
    });
    Ok(entries)
}

fn entry_json(entry: &Entry, rank: usize, viewer: &str, tiers: &[(String, i64)]) -> Value {
    let (tier, division) = tier_of(tiers, entry.points());
    json!({
        "rank": rank,
        "displayLabel": entry.label,
        "points": entry.points(),
        "verifiedPoints": entry.verified,
        "pendingPoints": entry.pending,
        "streak": entry.streak,
        "verifiedSkills": entry.skills,
        "isCurrentUser": entry.member_id == viewer,
        "tier": tier,
        "division": division,
    })
}

fn query_param(query: Option<&str>, name: &str) -> Option<String> {
    url::form_urlencoded::parse(query.unwrap_or_default().as_bytes())
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

pub(crate) async fn member_leaderboard(
    db: &SqlitePool,
    viewer: &Viewer,
    query: Option<&str>,
) -> ApiResult<Value> {
    let now = Utc::now();
    let all_seasons = seasons(db).await?;
    let season = select_season(&all_seasons, query_param(query, "season").as_deref(), now);
    let tiers = tiers(db).await?;
    let skills: Vec<(String, String)> =
        sqlx::query_as("SELECT slug, label FROM skills ORDER BY label")
            .fetch_all(db)
            .await
            .map_err(internal)?;
    let page = query_param(query, "page")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    let page_size = query_param(query, "pageSize")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(25)
        .clamp(1, MAX_PAGE_SIZE);
    let view = query_param(query, "view")
        .filter(|v| matches!(v.as_str(), "both" | "verified" | "pending"))
        .unwrap_or_else(|| "both".into());
    let skill_label = query_param(query, "skill").and_then(|slug| {
        skills
            .iter()
            .find(|(s, _)| *s == slug)
            .map(|(_, label)| label.clone())
    });

    let ranked: Vec<(usize, Entry)> = standings(db, season, now)
        .await?
        .into_iter()
        .enumerate()
        .map(|(index, entry)| (index + 1, entry))
        .filter(|(_, entry)| {
            skill_label
                .as_ref()
                .is_none_or(|label| entry.skills.contains(label))
        })
        .collect();
    let entries: Vec<Value> = ranked
        .iter()
        .skip((page - 1) * page_size)
        .take(page_size)
        .map(|(rank, entry)| entry_json(entry, *rank, &viewer.id, &tiers))
        .collect();
    Ok(json!({
        "season": season.map(|s| json!({"slug": s.slug, "label": s.label, "state": s.state(now), "startsAt": s.starts_at, "endsAt": s.ends_at})),
        "view": view,
        "entries": entries,
        "page": page,
        "pageSize": page_size,
        "total": ranked.len(),
        "skills": skills.iter().map(|(slug, label)| json!({"slug": slug, "label": label})).collect::<Vec<_>>(),
        "seasons": all_seasons.iter().map(|s| json!({"slug": s.slug, "label": s.label, "state": s.state(now)})).collect::<Vec<_>>(),
        "meta": {"mode": "live", "label": "Live leaderboard"},
    }))
}

/// Replaces the standing, points and community figures of the overview template
/// with values computed for the signed-in member.
pub(crate) async fn overlay_overview(
    db: &SqlitePool,
    viewer: &Viewer,
    overview: &mut Value,
) -> ApiResult<()> {
    let now = Utc::now();
    let all_seasons = seasons(db).await?;
    let season = select_season(&all_seasons, None, now);
    let tiers = tiers(db).await?;
    let ranked = standings(db, season, now).await?;
    let position = ranked.iter().position(|entry| entry.member_id == viewer.id);
    let standing = position.map(|index| (index + 1, ranked[index].clone()));
    let (verified_evidence,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM evidence_claims WHERE member_id = ? AND status = 'approved'",
    )
    .bind(&viewer.id)
    .fetch_one(db)
    .await
    .map_err(internal)?;
    let deltas: Vec<(i64, String)> =
        sqlx::query_as("SELECT delta, created_at FROM point_ledger WHERE member_id = ?")
            .bind(&viewer.id)
            .fetch_all(db)
            .await
            .map_err(internal)?;
    let this_week = week_index(now.fixed_offset());
    let activity: Vec<Value> = (0..ACTIVITY_WEEKS)
        .map(|offset| {
            let week = this_week - (ACTIVITY_WEEKS - 1 - offset);
            let points: i64 = deltas
                .iter()
                .filter(|(_, at)| parse(at).is_some_and(|at| week_index(at) == week))
                .map(|(delta, _)| delta)
                .sum();
            json!({"week": format!("W{}", offset + 1), "points": points})
        })
        .collect();
    let (reviewed,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM evidence_claim_reviews")
        .fetch_one(db)
        .await
        .map_err(internal)?;
    let (point_events,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM point_ledger WHERE delta > 0")
            .fetch_one(db)
            .await
            .map_err(internal)?;

    if let Some((rank, entry)) = &standing {
        overview["standing"] = entry_json(entry, *rank, &viewer.id, &tiers);
        overview["summary"]["points"] = json!(entry.verified);
        overview["summary"]["rank"] = json!(rank);
        overview["summary"]["streak"] = json!(entry.streak);
        let share = if entry.skills.is_empty() {
            0
        } else {
            entry.verified / entry.skills.len() as i64
        };
        overview["skillPoints"] = json!(
            entry
                .skills
                .iter()
                .map(|skill| json!({"skill": skill, "points": share}))
                .collect::<Vec<_>>()
        );
    }
    overview["summary"]["verifiedEvidence"] = json!(verified_evidence);
    overview["activity"] = json!(activity);
    overview["community"] = json!({
        "activeMembers": ranked.len(),
        "verifiedPointEvents": point_events,
        "reviewedEvidence": reviewed,
        "freshness": now.to_rfc3339(),
    });
    overview["meta"] = json!({"mode": "live", "label": "Live standing"});
    Ok(())
}
