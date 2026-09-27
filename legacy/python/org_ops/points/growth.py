"""Growth track — a DIAGNOSTIC / RECOMMENDATION engine. NOT a competing leaderboard.

It never changes anyone's rank and never redistributes points. Its only job: look at the
LOW-POINT bracket and their pretest/posttest GAIN, then surface which reachable lessons/events/
hackathons would help them climb toward the high-point level. The merit competition stays
cut-throat; this is the chance-to-grow pathway the org provides on the side.

Python port of domains/server/organization/workflow/points/growth.ts.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from org_ops.points.types import (
    Cluster,
    ClusterItem,
    GrowthAssessment,
    GrowthRecommendation,
    LeaderboardEntry,
)


def gain(assessment: GrowthAssessment) -> float:
    """gain = posttest - pretest. Negative gain is valid (the member regressed)."""
    return assessment.posttest - assessment.pretest


@dataclass(frozen=True)
class BracketOptions:
    """Options controlling which members are in the low-point bracket."""

    low_fraction: float = 0.5
    """Members in the bottom ``low_fraction`` of the ranking are the low-point bracket. 0..1."""


_DEFAULT_BRACKET = BracketOptions()


def _clamp01(value: float) -> float:
    return min(1.0, max(0.0, value))


def low_point_bracket(
    leaderboard: list[LeaderboardEntry],
    options: BracketOptions = _DEFAULT_BRACKET,
) -> set[str]:
    """Return member ids in the bottom fraction of the leaderboard.

    These are the members the growth track serves.
    """
    total = len(leaderboard)
    if total == 0:
        return set()
    cutoff = math.ceil(total * (1 - _clamp01(options.low_fraction)))
    return {e.member_id for e in leaderboard if e.rank > cutoff}


def difficulty_ceiling(assessments: list[GrowthAssessment]) -> int:
    """Map a member's best gain to the hardest difficulty (1..5) they should attempt next.

    Heuristic: 0 or negative gain → stay at 1; each +5 gain unlocks one difficulty step,
    capped at 5. Matches the TS ``difficultyCeiling`` function exactly.
    """
    if not assessments:
        return 1  # no signal yet — start gentle
    best_gain = max(gain(a) for a in assessments)
    return min(5, max(1, 1 + math.floor(max(0.0, best_gain) / 5)))


def _group_by_cluster(items: list[ClusterItem]) -> dict[str, list[ClusterItem]]:
    result: dict[str, list[ClusterItem]] = {}
    for item in items:
        result.setdefault(item.cluster_id, []).append(item)
    return result


def recommend_growth(
    leaderboard: list[LeaderboardEntry],
    assessments_by_member: dict[str, list[GrowthAssessment]],
    clusters: list[Cluster],
    items: list[ClusterItem],
    options: BracketOptions = _DEFAULT_BRACKET,
) -> list[GrowthRecommendation]:
    """Recommend reachable next steps for low-bracket members.

    Heuristic (deterministic, explainable — no AI required):
     - Only low-bracket members get recommendations.
     - A member's "reach level" is derived from their best recent gain: more gain → can handle a
       harder item. We map gain to a difficulty ceiling and recommend items at or below it,
       preferring the hardest reachable item per cluster so they actually move up.

    ``assessments_by_member`` holds each member's assessments; we use their max gain as the signal.

    DIAGNOSTIC ONLY — this function never changes rank or redistributes points.
    """
    bracket = low_point_bracket(leaderboard, options)
    items_by_cluster = _group_by_cluster(items)
    cluster_name: dict[str, str] = {c.id: c.name for c in clusters}
    out: list[GrowthRecommendation] = []

    for member_id in bracket:
        ceiling = difficulty_ceiling(assessments_by_member.get(member_id, []))
        for cluster_id, cluster_items in items_by_cluster.items():
            reachable = sorted(
                [it for it in cluster_items if it.difficulty <= ceiling],
                key=lambda it: it.difficulty,
                reverse=True,
            )
            if not reachable:
                continue
            pick = reachable[0]
            out.append(
                GrowthRecommendation(
                    member_id=member_id,
                    cluster_item_id=pick.id,
                    reason=(
                        f"Reachable {pick.kind} in {cluster_name.get(cluster_id, cluster_id)} "
                        f"(difficulty {pick.difficulty} ≤ your reach {ceiling}) "
                        f"to climb toward the top bracket."
                    ),
                )
            )

    return out
