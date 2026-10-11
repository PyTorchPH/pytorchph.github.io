//! Season-relative tier labels from the verified leaderboard cohort.
use crate::{ApiResult, internal};
use sqlx::SqlitePool;

pub(super) type Tiers = Vec<(String, i64)>;

pub(super) async fn load_tiers(db: &SqlitePool) -> ApiResult<Tiers> {
    sqlx::query_as("SELECT tier, min_points FROM rank_tiers ORDER BY min_points")
        .fetch_all(db)
        .await
        .map_err(internal)
}

// Mental model: a tier is a quantile of verified members in this season; each tier
// has three quantile divisions. Zero verified evidence remains unranked.
pub(super) fn tier_of_cohort(
    tiers: &[(String, i64)],
    rank: usize,
    cohort_size: usize,
    verified_points: i64,
) -> (String, &'static str, usize) {
    if verified_points <= 0 || cohort_size == 0 || tiers.is_empty() {
        return ("Unranked".into(), "III", 0);
    }
    let below = cohort_size.saturating_sub(rank);
    let band = below * tiers.len() * 3 / cohort_size;
    let tier_index = (band / 3).min(tiers.len() - 1);
    let division = match band % 3 {
        0 => "III",
        1 => "II",
        _ => "I",
    };
    let percentile = if cohort_size == 1 {
        100
    } else {
        below * 100 / (cohort_size - 1)
    };
    (tiers[tier_index].0.clone(), division, percentile)
}
