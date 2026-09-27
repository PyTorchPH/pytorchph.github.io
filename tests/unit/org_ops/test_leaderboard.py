"""Tests for org_ops.points.leaderboard.

Covers: outranks comparator, build_leaderboard (ranks 1-based dense), and each
tiebreaker level individually:
  1. total_points desc
  2. earlier first_earned_at wins
  3. more recent last_active_at wins
  4. nickname ascending
"""
from __future__ import annotations

from org_ops.points.leaderboard import build_leaderboard, outranks
from org_ops.points.types import MemberStanding


def _standing(
    member_id: str,
    total_points: float,
    nickname: str = "",
    first_earned_at: str | None = "2024-01-01T00:00:00Z",
    last_active_at: str | None = "2024-06-01T00:00:00Z",
) -> MemberStanding:
    return MemberStanding(
        member_id=member_id,
        total_points=total_points,
        first_earned_at=first_earned_at,
        last_active_at=last_active_at,
        nickname=nickname or member_id,
    )


# -- outranks: points-based ---------------------------------------------------

def test_outranks_higher_points_wins():
    a = _standing("a", 100)
    b = _standing("b", 50)
    assert outranks(a, b) is True
    assert outranks(b, a) is False

def test_outranks_equal_points_not_decided_by_points_alone():
    a = _standing("a", 50, first_earned_at="2024-01-01T00:00:00Z")
    b = _standing("b", 50, first_earned_at="2024-06-01T00:00:00Z")
    # a earned earlier, so a outranks b
    assert outranks(a, b) is True


# -- outranks tiebreaker: first_earned_at ------------------------------------

def test_outranks_earlier_first_earned_at_wins_when_points_tied():
    a = _standing("a", 50, first_earned_at="2024-01-01T00:00:00Z")
    b = _standing("b", 50, first_earned_at="2024-06-01T00:00:00Z")
    assert outranks(a, b) is True
    assert outranks(b, a) is False

def test_outranks_null_first_earned_at_loses_to_real_timestamp():
    # null sentinel "￿" sorts after any real ISO date
    a = _standing("a", 50, first_earned_at="2024-01-01T00:00:00Z")
    b = _standing("b", 50, first_earned_at=None)
    assert outranks(a, b) is True
    assert outranks(b, a) is False


# -- outranks tiebreaker: last_active_at -------------------------------------

def test_outranks_more_recent_last_active_at_wins_when_first_earned_tied():
    ts = "2024-01-01T00:00:00Z"  # same first_earned_at
    a = _standing("a", 50, first_earned_at=ts, last_active_at="2024-12-01T00:00:00Z")
    b = _standing("b", 50, first_earned_at=ts, last_active_at="2024-03-01T00:00:00Z")
    assert outranks(a, b) is True
    assert outranks(b, a) is False

def test_outranks_null_last_active_at_loses_to_real_timestamp():
    # null sentinel "" sorts before any real ISO date
    ts = "2024-01-01T00:00:00Z"
    a = _standing("a", 50, first_earned_at=ts, last_active_at="2024-06-01T00:00:00Z")
    b = _standing("b", 50, first_earned_at=ts, last_active_at=None)
    assert outranks(a, b) is True
    assert outranks(b, a) is False


# -- outranks tiebreaker: nickname asc ----------------------------------------

def test_outranks_nickname_ascending_as_final_tiebreaker():
    ts_first = "2024-01-01T00:00:00Z"
    ts_last = "2024-06-01T00:00:00Z"
    a = _standing("a", 50, nickname="Aaron", first_earned_at=ts_first, last_active_at=ts_last)
    b = _standing("b", 50, nickname="Zara",  first_earned_at=ts_first, last_active_at=ts_last)
    # "Aaron" < "Zara" → Aaron outranks Zara
    assert outranks(a, b) is True
    assert outranks(b, a) is False


# -- build_leaderboard: basic merit ranking -----------------------------------

def test_build_leaderboard_ranks_are_1_based_dense():
    standings = [_standing("a", 300), _standing("b", 200), _standing("c", 100)]
    board = build_leaderboard(standings)
    ranks = [e.rank for e in board]
    assert ranks == [1, 2, 3]

def test_build_leaderboard_orders_by_total_points_descending():
    standings = [
        _standing("low", 100),
        _standing("high", 500),
        _standing("mid", 250),
    ]
    board = build_leaderboard(standings)
    assert board[0].member_id == "high"
    assert board[1].member_id == "mid"
    assert board[2].member_id == "low"

def test_build_leaderboard_empty_standings_returns_empty():
    assert build_leaderboard([]) == []

def test_build_leaderboard_single_standing_has_rank_1():
    board = build_leaderboard([_standing("solo", 42)])
    assert len(board) == 1
    assert board[0].rank == 1

def test_build_leaderboard_preserves_all_standing_fields():
    s = _standing("alice", 100, nickname="Alice",
                  first_earned_at="2024-02-01T00:00:00Z",
                  last_active_at="2024-08-01T00:00:00Z")
    board = build_leaderboard([s])
    entry = board[0]
    assert entry.member_id == "alice"
    assert entry.total_points == 100
    assert entry.nickname == "Alice"
    assert entry.first_earned_at == "2024-02-01T00:00:00Z"
    assert entry.last_active_at == "2024-08-01T00:00:00Z"


# -- build_leaderboard: tiebreaker integration --------------------------------

def test_tiebreaker_level1_total_points():
    """Higher total_points -> lower rank number (better position)."""
    standings = [_standing("low", 50), _standing("high", 200)]
    board = build_leaderboard(standings)
    assert board[0].member_id == "high"
    assert board[0].rank == 1

def test_tiebreaker_level2_earlier_first_earned_at():
    """When points tied, earlier first_earned_at wins."""
    a = _standing("early", 50, first_earned_at="2024-01-01T00:00:00Z",
                  last_active_at="2024-06-01T00:00:00Z")
    b = _standing("late",  50, first_earned_at="2024-06-01T00:00:00Z",
                  last_active_at="2024-06-01T00:00:00Z")
    board = build_leaderboard([b, a])  # intentionally reversed input
    assert board[0].member_id == "early"
    assert board[0].rank == 1
    assert board[1].rank == 2

def test_tiebreaker_level3_more_recent_last_active_at():
    """When points and first_earned_at tied, more recent last_active_at wins."""
    ts = "2024-01-01T00:00:00Z"
    a = _standing("active",  50, first_earned_at=ts, last_active_at="2024-12-01T00:00:00Z")
    b = _standing("dormant", 50, first_earned_at=ts, last_active_at="2024-03-01T00:00:00Z")
    board = build_leaderboard([b, a])
    assert board[0].member_id == "active"
    assert board[0].rank == 1

def test_tiebreaker_level4_nickname_ascending():
    """Final fallback: nickname ascending."""
    ts_first = "2024-01-01T00:00:00Z"
    ts_last  = "2024-06-01T00:00:00Z"
    a = _standing("a", 50, nickname="Aaron", first_earned_at=ts_first, last_active_at=ts_last)
    b = _standing("b", 50, nickname="Zara",  first_earned_at=ts_first, last_active_at=ts_last)
    board = build_leaderboard([b, a])
    assert board[0].nickname == "Aaron"
    assert board[0].rank == 1
    assert board[1].nickname == "Zara"
    assert board[1].rank == 2

def test_build_leaderboard_does_not_mutate_input():
    standings = [_standing("a", 300), _standing("b", 200)]
    original_first = standings[0].member_id
    build_leaderboard(standings)
    assert standings[0].member_id == original_first
