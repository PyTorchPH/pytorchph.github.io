"""Domain types for the Points · Leaderboard · Growth engine (org-ops layer).

Confirmed model (docs/POINTS-ENGINE.md):
 - point_events is an APPEND-ONLY ledger; standings are DERIVED, never stored as truth.
 - The leaderboard is a CUT-THROAT MERIT ranking (no equity handouts).
 - The growth track is a DIAGNOSTIC engine, NOT a competing ranking.

This is a faithful Python port of domains/server/organization/workflow/points/types.ts.
Field names follow Python snake_case convention; semantics are identical to the TS originals.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict


class PointSource(str, Enum):
    """Where a point award came from. Achievements/grades/projects are the highest-priority signals."""

    ACHIEVEMENT = "achievement"
    GRADE = "grade"
    PROJECT = "project"
    REFERRAL = "referral"
    ACTIVITY = "activity"


class PointEvent(BaseModel):
    """One immutable row of the append-only points ledger."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    member_id: str
    source: PointSource
    """Raw points before weighting."""
    points: float
    """Multiplier applied per source (mirrors the SQL `weight`)."""
    weight: float
    """ISO timestamp — passed in, never generated here (keeps the engine pure)."""
    earned_at: str


class MemberStanding(BaseModel):
    """Derived per-member totals used to build the leaderboard."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    member_id: str
    """Sum of points * weight across the member's ledger."""
    total_points: float
    """ISO timestamp of the member's earliest point event (tiebreaker)."""
    first_earned_at: str | None = None
    """ISO timestamp of the member's most recent point event (tiebreaker)."""
    last_active_at: str | None = None
    """Public-safe label only — never email/PII (SPECIFICATION §6)."""
    nickname: str


class LeaderboardEntry(MemberStanding):
    """A ranked leaderboard row. Public-safe by construction."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    rank: int


class Cluster(BaseModel):
    """A cluster groups tangible opportunities by domain (academics, tutorial, ...)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    name: str


class ClusterItem(BaseModel):
    """A concrete project/competition a member can pick from, hanging off a cluster."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    cluster_id: str
    title: str
    kind: Literal["lesson", "event", "hackathon", "competition"]
    """Rough difficulty 1..5 — used by the growth engine to recommend reachable steps."""
    difficulty: int


class GrowthAssessment(BaseModel):
    """A pretest/posttest pair for one member on one activity. `gain = posttest - pretest`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    member_id: str
    activity_id: str
    pretest: float
    posttest: float


class GrowthRecommendation(BaseModel):
    """A diagnostic recommendation. Diagnostic ONLY — never changes rank or redistributes points."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    member_id: str
    cluster_item_id: str
    reason: str
