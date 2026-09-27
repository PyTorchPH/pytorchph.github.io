"""Public surface of the points · leaderboard · growth engine.

Re-exports the full public API so callers can import directly from ``org_ops.points``:

    from org_ops.points import build_leaderboard, aggregate_standings, recommend_growth
"""

from __future__ import annotations

from org_ops.points.growth import (
    BracketOptions,
    difficulty_ceiling,
    gain,
    low_point_bracket,
    recommend_growth,
)
from org_ops.points.heap import PriorityQueue
from org_ops.points.leaderboard import build_leaderboard, outranks
from org_ops.points.scoring import (
    DEFAULT_SOURCE_WEIGHTS,
    aggregate_standings,
    effective_weight,
    weighted_points,
)
from org_ops.points.types import (
    Cluster,
    ClusterItem,
    GrowthAssessment,
    GrowthRecommendation,
    LeaderboardEntry,
    MemberStanding,
    PointEvent,
    PointSource,
)

__all__ = [
    # types
    "PointSource",
    "PointEvent",
    "MemberStanding",
    "LeaderboardEntry",
    "Cluster",
    "ClusterItem",
    "GrowthAssessment",
    "GrowthRecommendation",
    # heap
    "PriorityQueue",
    # scoring
    "DEFAULT_SOURCE_WEIGHTS",
    "effective_weight",
    "weighted_points",
    "aggregate_standings",
    # leaderboard
    "outranks",
    "build_leaderboard",
    # growth
    "BracketOptions",
    "gain",
    "low_point_bracket",
    "difficulty_ceiling",
    "recommend_growth",
]
