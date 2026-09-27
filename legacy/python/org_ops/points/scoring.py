"""Point scoring — turns the append-only ledger into derived per-member standings.

Weights encode the confirmed priority: achievements/grades/projects are the highest-priority
signals; referral is the lightest. Weights are the ENGINE DEFAULT; the SQL stores a `weight`
per row so admins can override per event. When an event carries its own weight, we trust it;
otherwise we apply the source default below.

Python port of domains/server/organization/workflow/points/scoring.ts.
"""

from __future__ import annotations

from org_ops.points.types import MemberStanding, PointEvent, PointSource

# Default per-source weight. Tunable; mirrors the intent in docs/POINTS-ENGINE.md.
DEFAULT_SOURCE_WEIGHTS: dict[str, float] = {
    PointSource.ACHIEVEMENT: 5,
    PointSource.GRADE: 4,
    PointSource.PROJECT: 4,
    PointSource.ACTIVITY: 2,
    PointSource.REFERRAL: 1,
}


def effective_weight(event: PointEvent) -> float:
    """The weight to use for an event: its explicit weight if positive, else the source default."""
    return event.weight if event.weight > 0 else DEFAULT_SOURCE_WEIGHTS[event.source]


def weighted_points(event: PointEvent) -> float:
    """Weighted contribution of a single ledger row."""
    return event.points * effective_weight(event)


def _min_iso(a: str | None, b: str) -> str:
    """Return the earlier of two ISO timestamps; treats None as 'no earlier bound'."""
    return b if a is None or b < a else a


def _max_iso(a: str | None, b: str) -> str:
    """Return the later of two ISO timestamps; treats None as 'no later bound'."""
    return b if a is None or b > a else a


def aggregate_standings(
    events: list[PointEvent],
    nicknames: dict[str, str],
) -> list[MemberStanding]:
    """Fold the ledger into one standing per member.

    ``nicknames`` supplies the public-safe label; a member with no nickname falls back to their
    id so the engine never invents PII.

    Returns a new list; the input ``events`` sequence is never mutated.
    """
    by_member: dict[str, MemberStanding] = {}

    for event in events:
        contribution = weighted_points(event)
        if event.member_id in by_member:
            existing = by_member[event.member_id]
            by_member[event.member_id] = existing.model_copy(
                update={
                    "total_points": existing.total_points + contribution,
                    "first_earned_at": _min_iso(existing.first_earned_at, event.earned_at),
                    "last_active_at": _max_iso(existing.last_active_at, event.earned_at),
                }
            )
        else:
            by_member[event.member_id] = MemberStanding(
                member_id=event.member_id,
                total_points=contribution,
                first_earned_at=event.earned_at,
                last_active_at=event.earned_at,
                nickname=nicknames.get(event.member_id, event.member_id),
            )

    return list(by_member.values())
