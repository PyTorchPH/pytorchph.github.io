//! Leaderboard seasons and the calendar arithmetic built on them.
//!
//! Module map (caller-first):
//!   load_seasons       every season, newest first (rows with unparsable dates are skipped)
//!   select_season      the requested season, else the active one, else the newest
//!   Season::state      upcoming / active / completed at a moment
//!   Season::contains   whether a moment falls inside the season
//!   parse_time         RFC 3339 text to a timestamp
//!   is_in_season       a ledger or claim timestamp counts for the chosen season
//!   week_index         a stable number per ISO week
//!   current_week
use crate::{ApiResult, internal};
use chrono::{DateTime, Datelike, FixedOffset, Utc};
use sqlx::SqlitePool;

pub(super) struct Season {
    pub slug: String,
    pub label: String,
    pub starts_at: String,
    pub ends_at: String,
    start: DateTime<FixedOffset>,
    end: DateTime<FixedOffset>,
}

impl Season {
    pub(super) fn state(&self, now: DateTime<Utc>) -> &'static str {
        if now < self.start {
            "upcoming"
        } else if now >= self.end {
            "completed"
        } else {
            "active"
        }
    }

    #[inline]
    pub(super) fn contains(&self, at: DateTime<FixedOffset>) -> bool {
        at >= self.start && at < self.end
    }

    #[inline]
    fn is_active(&self, now: DateTime<Utc>) -> bool {
        self.state(now) == "active"
    }
}

pub(super) async fn load_seasons(db: &SqlitePool) -> ApiResult<Vec<Season>> {
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
                start: parse_time(&starts_at)?,
                end: parse_time(&ends_at)?,
                slug,
                label,
                starts_at,
                ends_at,
            })
        })
        .collect())
}

pub(super) fn select_season<'a>(
    all: &'a [Season],
    slug: Option<&str>,
    now: DateTime<Utc>,
) -> Option<&'a Season> {
    slug.and_then(|wanted| all.iter().find(|season| season.slug == wanted))
        .or_else(|| all.iter().find(|season| season.is_active(now)))
        .or_else(|| all.first())
}

#[inline]
pub(super) fn parse_time(at: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(at).ok()
}

// Without a season every timestamp counts.
#[inline]
pub(super) fn is_in_season(at: &str, season: Option<&Season>) -> bool {
    parse_time(at).is_some_and(|at| season.is_none_or(|season| season.contains(at)))
}

pub(super) fn week_index(at: DateTime<FixedOffset>) -> i64 {
    let date = at.with_timezone(&Utc).date_naive();
    i64::from(date.iso_week().year()) * 53 + i64::from(date.iso_week().week())
}

#[inline]
pub(super) fn current_week(now: DateTime<Utc>) -> i64 {
    week_index(now.fixed_offset())
}
