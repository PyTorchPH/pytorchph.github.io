//! The published point rubric: which levels an officer may verify and what they are worth.
//!
//! Module map:
//!   is_rubric_level     whether a level name is one the rubric defines
//!   rubric_points       (rubric version, weighted points) for a verified level
//!   └─ weighted_points
//!      └─ source_weight
use crate::{ApiResult, internal};
use sqlx::SqliteConnection;

const LEVELS: [&str; 4] = [
    "participation",
    "contributor",
    "finalist_lead",
    "winner_top_award",
];
const POINTS_PER_UNIT: i64 = 10;

#[inline]
pub(crate) fn is_rubric_level(level: &str) -> bool {
    LEVELS.contains(&level)
}

/// Weighted points for a verified level under the newest published rubric.
pub(crate) async fn rubric_points(
    conn: &mut SqliteConnection,
    source: &str,
    level: &str,
) -> ApiResult<Option<(i64, i64)>> {
    let row: Option<(i64, i64)> = sqlx::query_as(
        "SELECT l.rubric_version, l.units FROM point_rubric_levels l \
         JOIN point_rubric_versions v ON v.version = l.rubric_version \
         WHERE l.level = ? AND v.published_at IS NOT NULL ORDER BY l.rubric_version DESC LIMIT 1",
    )
    .bind(level)
    .fetch_optional(conn)
    .await
    .map_err(internal)?;
    Ok(row.map(|(version, units)| (version, weighted_points(units, source))))
}

#[inline]
fn weighted_points(units: i64, source: &str) -> i64 {
    ((units * POINTS_PER_UNIT) as f64 * source_weight(source)).round() as i64
}

#[inline]
fn source_weight(source: &str) -> f64 {
    if source == "github" { 2.0 } else { 3.0 }
}
