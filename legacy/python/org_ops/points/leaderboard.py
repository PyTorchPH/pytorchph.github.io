"""Cut-throat merit leaderboard.

This is THE competitive ranking. No equity handouts, no redistribution — raw weighted points
decide order. Ties are broken DETERMINISTICALLY so the ranking is stable and auditable:

  1. higher total_points
  2. earlier first_earned_at  (rewarded the member who got there first)
  3. more recent last_active_at (rewarded the member still showing up)
  4. nickname ascending        (final deterministic fallback)

Built on the PriorityQueue so the "heap priority queue" is the actual ranking mechanism.

Python port of domains/server/organization/workflow/points/leaderboard.ts.
"""

from __future__ import annotations

from org_ops.points.heap import PriorityQueue
from org_ops.points.types import LeaderboardEntry, MemberStanding

# Sentinels for null timestamp comparisons — identical to the TS source.
# Any ISO date string is composed of ASCII characters (0x30-0x5A range) so both sentinels
# safely sort outside the space of real timestamps.
_SENTINEL_HIGH = "￿"  # null firstEarnedAt → treated as "latest possible"
_SENTINEL_LOW = ""         # null lastActiveAt  → treated as "earliest possible"


def outranks(a: MemberStanding, b: MemberStanding) -> bool:
    """Return True when ``a`` outranks ``b`` under the merit + tiebreaker order."""
    if a.total_points != b.total_points:
        return a.total_points > b.total_points

    # Earlier first-earned wins. A null (no events) is treated as "latest possible".
    a_first = a.first_earned_at if a.first_earned_at is not None else _SENTINEL_HIGH
    b_first = b.first_earned_at if b.first_earned_at is not None else _SENTINEL_HIGH
    if a_first != b_first:
        return a_first < b_first

    # More recent activity wins. A null is treated as "earliest possible".
    a_last = a.last_active_at if a.last_active_at is not None else _SENTINEL_LOW
    b_last = b.last_active_at if b.last_active_at is not None else _SENTINEL_LOW
    if a_last != b_last:
        return a_last > b_last

    return a.nickname < b.nickname


def build_leaderboard(standings: list[MemberStanding]) -> list[LeaderboardEntry]:
    """Rank standings into a leaderboard, highest first.

    Drains a max-heap so the ordering is exactly the ``outranks`` comparator above.
    ``rank`` is 1-based and dense (ties cannot occur — the tiebreaker is total).

    Returns a new list; the input ``standings`` sequence is never mutated.
    """
    queue: PriorityQueue[MemberStanding] = PriorityQueue(outranks, standings)
    return [
        LeaderboardEntry(**standing.model_dump(), rank=i + 1)
        for i, standing in enumerate(queue.drain_sorted())
    ]
