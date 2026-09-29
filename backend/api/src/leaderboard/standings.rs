//! Season standings: one ranked entry per eligible member.
//!
//! Module map (caller-first):
//!   standings                         every eligible member ranked for a season
//!   ├─ eligible_members               approved members without an active sanction, with privacy flags
//!   ├─ ledger_rows / pending_claims / member_skill_rows
//!   ├─ participation_units            rubric units for the lowest evidence level
//!   ├─ verified_points_and_weeks      season points and every week with a positive award
//!   ├─ provisional_points             expected points of claims still waiting for review
//!   │   └─ claim_weight
//!   ├─ skills_by_member
//!   ├─ build_entry
//!   │   ├─ display_label              anonymous alias, chosen username, or public handle
//!   │   ├─ is_flag_on
//!   │   └─ streak                     consecutive active weeks ending now
//!   └─ sort_by_rank                   points, then verified points, then label
//!   entry_json                        the JSON shape of one leaderboard row
//!   Entry::points / Entry::is_viewer / Entry::is_profile_visible_to
use super::{
    seasons::{Season, current_week, is_in_season, parse_time, week_index},
    tiers::tier_of,
};
use crate::{ApiResult, evidence::integrity::member_label, internal};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use std::collections::{BTreeSet, HashMap};

/// Member id, public handle, chosen username, anonymousRanking flag, shareAchievements flag.
type MemberRow = (String, String, Option<String>, Option<i64>, Option<i64>);

#[derive(Clone)]
pub(super) struct Entry {
    pub member_id: String,
    pub label: String,
    pub verified: i64,
    pub pending: i64,
    pub streak: i64,
    pub skills: Vec<String>,
    pub anonymous: bool,
    // Implicit deny: achievements are visible to others only after the member opts in.
    pub shares_achievements: bool,
}

impl Entry {
    #[inline]
    pub(super) fn points(&self) -> i64 {
        self.verified + self.pending
    }

    #[inline]
    pub(super) fn is_viewer(&self, viewer: &str) -> bool {
        self.member_id == viewer
    }

    #[inline]
    pub(super) fn is_profile_visible_to(&self, viewer: &str) -> bool {
        self.shares_achievements || self.is_viewer(viewer)
    }
}

// Mental model: load every input once, fold ledger rows and pending claims into per-member
// totals for the season, then build and sort one entry per eligible member.
pub(super) async fn standings(
    db: &SqlitePool,
    season: Option<&Season>,
    now: DateTime<Utc>,
) -> ApiResult<Vec<Entry>> {
    let members = eligible_members(db).await?;
    let ledger = ledger_rows(db).await?;
    let pending = pending_claims(db).await?;
    let skill_rows = member_skill_rows(db).await?;
    let units = participation_units(db).await?;

    let (verified, weeks) = verified_points_and_weeks(&ledger, season);
    let provisional = provisional_points(&pending, units, season);
    let mut skills = skills_by_member(&skill_rows);
    let mut entries: Vec<Entry> = members
        .iter()
        .map(|member| build_entry(member, &verified, &provisional, &weeks, &mut skills, now))
        .collect();
    sort_by_rank(&mut entries);
    Ok(entries)
}

async fn eligible_members(db: &SqlitePool) -> ApiResult<Vec<MemberRow>> {
    sqlx::query_as(
        "SELECT m.id, m.public_handle, \
                (SELECT json_extract(value_json, '$.username') FROM portal_state WHERE scope = m.id AND state_key = '/api/member/leaderboard-identity'), \
                (SELECT json_extract(value_json, '$.anonymousRanking') FROM portal_state WHERE scope = m.id AND state_key = '/api/member/privacy'), \
                (SELECT json_extract(value_json, '$.shareAchievements') FROM portal_state WHERE scope = m.id AND state_key = '/api/member/privacy') \
         FROM members m WHERE m.role != 'pending' \
         AND NOT EXISTS (SELECT 1 FROM leaderboard_sanctions s WHERE s.member_id = m.id AND s.lifted_at IS NULL)",
    )
    .fetch_all(db)
    .await
    .map_err(internal)
}

async fn ledger_rows(db: &SqlitePool) -> ApiResult<Vec<(String, i64, String)>> {
    sqlx::query_as("SELECT member_id, delta, created_at FROM point_ledger")
        .fetch_all(db)
        .await
        .map_err(internal)
}

async fn pending_claims(db: &SqlitePool) -> ApiResult<Vec<(String, String, String)>> {
    sqlx::query_as(
        "SELECT member_id, source, created_at FROM evidence_claims WHERE status = 'pending'",
    )
    .fetch_all(db)
    .await
    .map_err(internal)
}

async fn member_skill_rows(db: &SqlitePool) -> ApiResult<Vec<(String, String)>> {
    sqlx::query_as(
        "SELECT ms.member_id, s.label FROM member_skills ms JOIN skills s ON s.slug = ms.skill_slug ORDER BY s.label",
    )
    .fetch_all(db)
    .await
    .map_err(internal)
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

// Season points count only in-season rows; activity weeks count every positive award.
fn verified_points_and_weeks<'a>(
    ledger: &'a [(String, i64, String)],
    season: Option<&Season>,
) -> (HashMap<&'a str, i64>, HashMap<&'a str, BTreeSet<i64>>) {
    let mut verified: HashMap<&str, i64> = HashMap::new();
    let mut weeks: HashMap<&str, BTreeSet<i64>> = HashMap::new();
    for (member, delta, at) in ledger {
        if is_in_season(at, season) {
            *verified.entry(member.as_str()).or_default() += delta;
        }
        if let (true, Some(at)) = (*delta > 0, parse_time(at)) {
            weeks
                .entry(member.as_str())
                .or_default()
                .insert(week_index(at));
        }
    }
    (verified, weeks)
}

fn provisional_points<'a>(
    pending: &'a [(String, String, String)],
    units: i64,
    season: Option<&Season>,
) -> HashMap<&'a str, i64> {
    let mut provisional: HashMap<&str, i64> = HashMap::new();
    for (member, source, at) in pending {
        if is_in_season(at, season) {
            *provisional.entry(member.as_str()).or_default() += units * 10 * claim_weight(source);
        }
    }
    provisional
}

// GitHub evidence weighs 2, every other source 3 (same weights as the review rubric).
#[inline]
fn claim_weight(source: &str) -> i64 {
    if source == "github" { 2 } else { 3 }
}

fn skills_by_member(rows: &[(String, String)]) -> HashMap<&str, Vec<String>> {
    let mut skills: HashMap<&str, Vec<String>> = HashMap::new();
    for (member, label) in rows {
        skills
            .entry(member.as_str())
            .or_default()
            .push(label.clone());
    }
    skills
}

fn build_entry(
    (id, handle, username, anonymous, shares): &MemberRow,
    verified: &HashMap<&str, i64>,
    provisional: &HashMap<&str, i64>,
    weeks: &HashMap<&str, BTreeSet<i64>>,
    skills: &mut HashMap<&str, Vec<String>>,
    now: DateTime<Utc>,
) -> Entry {
    Entry {
        member_id: id.clone(),
        label: display_label(id, handle, username.as_deref(), *anonymous),
        verified: verified.get(id.as_str()).copied().unwrap_or(0).max(0),
        pending: provisional.get(id.as_str()).copied().unwrap_or(0),
        streak: weeks.get(id.as_str()).map_or(0, |set| streak(set, now)),
        skills: skills.remove(id.as_str()).unwrap_or_default(),
        anonymous: is_flag_on(*anonymous),
        shares_achievements: is_flag_on(*shares),
    }
}

fn display_label(id: &str, handle: &str, username: Option<&str>, anonymous: Option<i64>) -> String {
    if is_flag_on(anonymous) {
        member_label(id)
    } else {
        username
            .filter(|name| !name.is_empty())
            .map_or_else(|| handle.to_owned(), str::to_owned)
    }
}

// Privacy flags are stored as JSON booleans, which SQLite's json_extract returns as 0/1.
#[inline]
fn is_flag_on(flag: Option<i64>) -> bool {
    flag.unwrap_or(0) == 1
}

// Consecutive ISO weeks with earned points, ending this week or last week.
fn streak(weeks: &BTreeSet<i64>, now: DateTime<Utc>) -> i64 {
    let current = current_week(now);
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

fn sort_by_rank(entries: &mut [Entry]) {
    entries.sort_by(|a, b| {
        b.points()
            .cmp(&a.points())
            .then(b.verified.cmp(&a.verified))
            .then(a.label.cmp(&b.label))
    });
}

pub(super) fn entry_json(
    entry: &Entry,
    rank: usize,
    viewer: &str,
    tiers: &[(String, i64)],
) -> Value {
    let (tier, division) = tier_of(tiers, entry.points());
    json!({
        "rank": rank,
        "displayLabel": entry.label,
        "points": entry.points(),
        "verifiedPoints": entry.verified,
        "pendingPoints": entry.pending,
        "streak": entry.streak,
        "verifiedSkills": entry.skills,
        "isCurrentUser": entry.is_viewer(viewer),
        "profileId": entry.is_profile_visible_to(viewer).then_some(&entry.member_id),
        "tier": tier,
        "division": division,
    })
}
