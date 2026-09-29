//! Rank tiers (Bronze, Silver, …) and their III / II / I divisions.
//!
//! Module map (caller-first):
//!   load_tiers         tier names with their minimum points, lowest first
//!   tier_of            the tier a point total reaches, and its division
//!   ├─ tier_band       points between this tier and the next (at least 3)
//!   └─ division_in     which third of the band the total sits in
use crate::{ApiResult, internal};
use sqlx::SqlitePool;

/// Band width used above the highest tier, where there is no next threshold.
const TOP_TIER_BAND: i64 = 1000;

pub(super) type Tiers = Vec<(String, i64)>;

pub(super) async fn load_tiers(db: &SqlitePool) -> ApiResult<Tiers> {
    sqlx::query_as("SELECT tier, min_points FROM rank_tiers ORDER BY min_points")
        .fetch_all(db)
        .await
        .map_err(internal)
}

// Tier by threshold; division III..I splits the tier's band into thirds.
pub(super) fn tier_of(tiers: &[(String, i64)], points: i64) -> (String, &'static str) {
    let index = tiers
        .iter()
        .rposition(|(_, min)| points >= *min)
        .unwrap_or(0);
    let Some((tier, min)) = tiers.get(index) else {
        return ("Unranked".into(), "III");
    };
    let band = tier_band(tiers, index, *min);
    (tier.clone(), division_in(points - min, band))
}

#[inline]
fn tier_band(tiers: &[(String, i64)], index: usize, min: i64) -> i64 {
    tiers
        .get(index + 1)
        .map_or(TOP_TIER_BAND, |(_, next)| next - min)
        .max(3)
}

#[inline]
fn division_in(points_into_tier: i64, band: i64) -> &'static str {
    match points_into_tier * 3 / band {
        0 => "III",
        1 => "II",
        _ => "I",
    }
}
