"""Tests for org_ops.points.scoring."""
from __future__ import annotations
from org_ops.points.scoring import (
    DEFAULT_SOURCE_WEIGHTS, aggregate_standings, effective_weight, weighted_points,
)
from org_ops.points.types import MemberStanding, PointEvent, PointSource


def _event(id, member_id, source, points, weight, earned_at):
    return PointEvent(id=id, member_id=member_id, source=source,
                      points=points, weight=weight, earned_at=earned_at)


# -- DEFAULT_SOURCE_WEIGHTS ---------------------------------------------------

def test_default_weights_contain_all_sources():
    for source in PointSource:
        assert source in DEFAULT_SOURCE_WEIGHTS

def test_achievement_has_highest_weight():
    assert DEFAULT_SOURCE_WEIGHTS[PointSource.ACHIEVEMENT] == 5

def test_referral_has_lowest_weight():
    assert DEFAULT_SOURCE_WEIGHTS[PointSource.REFERRAL] == 1


# -- effective_weight ---------------------------------------------------------

def test_effective_weight_uses_explicit_positive_weight():
    ev = _event("e1", "m1", PointSource.ACTIVITY, 10, 3, "2024-01-01T00:00:00Z")
    assert effective_weight(ev) == 3

def test_effective_weight_falls_back_when_weight_is_zero():
    ev = _event("e2", "m1", PointSource.ACHIEVEMENT, 10, 0, "2024-01-01T00:00:00Z")
    assert effective_weight(ev) == DEFAULT_SOURCE_WEIGHTS[PointSource.ACHIEVEMENT]

def test_effective_weight_falls_back_when_weight_is_negative():
    ev = _event("e3", "m1", PointSource.GRADE, 10, -1, "2024-01-01T00:00:00Z")
    assert effective_weight(ev) == DEFAULT_SOURCE_WEIGHTS[PointSource.GRADE]

def test_effective_weight_fallback_for_every_source():
    for source in PointSource:
        ev = _event("ex", "mx", source, 1, 0, "2024-01-01T00:00:00Z")
        assert effective_weight(ev) == DEFAULT_SOURCE_WEIGHTS[source]


# -- weighted_points ----------------------------------------------------------

def test_weighted_points_multiplies_by_explicit_weight():
    ev = _event("e4", "m1", PointSource.PROJECT, 10, 2, "2024-01-01T00:00:00Z")
    assert weighted_points(ev) == 20.0

def test_weighted_points_uses_default_when_weight_zero():
    ev = _event("e5", "m1", PointSource.ACHIEVEMENT, 5, 0, "2024-01-01T00:00:00Z")
    # 5 * 5 (ACHIEVEMENT default) = 25
    assert weighted_points(ev) == 25.0


# -- aggregate_standings: basic folding ---------------------------------------

def test_single_event_creates_one_standing():
    events = [_event("e1", "alice", PointSource.ACHIEVEMENT, 10, 2, "2024-03-01T10:00:00Z")]
    result = aggregate_standings(events, {"alice": "Alice"})
    assert len(result) == 1
    s = result[0]
    assert s.member_id == "alice"
    assert s.total_points == 20.0
    assert s.nickname == "Alice"

def test_multiple_events_same_member_are_summed():
    events = [
        _event("e1", "bob", PointSource.GRADE, 10, 1, "2024-01-01T00:00:00Z"),
        _event("e2", "bob", PointSource.PROJECT, 5, 2, "2024-02-01T00:00:00Z"),
    ]
    result = aggregate_standings(events, {})
    assert len(result) == 1
    assert result[0].total_points == 10 + 10  # 10*1 + 5*2

def test_different_members_produce_separate_standings():
    events = [
        _event("e1", "alice", PointSource.ACHIEVEMENT, 10, 1, "2024-01-01T00:00:00Z"),
        _event("e2", "bob", PointSource.ACTIVITY, 20, 1, "2024-01-02T00:00:00Z"),
    ]
    result = aggregate_standings(events, {})
    ids = {s.member_id for s in result}
    assert ids == {"alice", "bob"}

def test_empty_events_returns_empty():
    assert aggregate_standings([], {}) == []


# -- aggregate_standings: nickname fallback -----------------------------------

def test_uses_provided_nickname():
    events = [_event("e1", "alice", PointSource.ACTIVITY, 5, 1, "2024-01-01T00:00:00Z")]
    result = aggregate_standings(events, {"alice": "Alice A."})
    assert result[0].nickname == "Alice A."

def test_falls_back_to_member_id_when_no_nickname():
    events = [_event("e1", "unknown-member", PointSource.ACTIVITY, 5, 1, "2024-01-01T00:00:00Z")]
    result = aggregate_standings(events, {})
    assert result[0].nickname == "unknown-member"


# -- aggregate_standings: timestamps ------------------------------------------

def test_first_earned_at_is_earliest_timestamp():
    events = [
        _event("e1", "carol", PointSource.GRADE, 5, 1, "2024-06-15T00:00:00Z"),
        _event("e2", "carol", PointSource.GRADE, 5, 1, "2024-03-10T00:00:00Z"),
        _event("e3", "carol", PointSource.GRADE, 5, 1, "2024-09-01T00:00:00Z"),
    ]
    result = aggregate_standings(events, {})
    assert result[0].first_earned_at == "2024-03-10T00:00:00Z"

def test_last_active_at_is_latest_timestamp():
    events = [
        _event("e1", "carol", PointSource.GRADE, 5, 1, "2024-06-15T00:00:00Z"),
        _event("e2", "carol", PointSource.GRADE, 5, 1, "2024-03-10T00:00:00Z"),
        _event("e3", "carol", PointSource.GRADE, 5, 1, "2024-09-01T00:00:00Z"),
    ]
    result = aggregate_standings(events, {})
    assert result[0].last_active_at == "2024-09-01T00:00:00Z"

def test_single_event_first_and_last_timestamps_match():
    events = [_event("e1", "dave", PointSource.REFERRAL, 1, 1, "2024-05-20T12:00:00Z")]
    result = aggregate_standings(events, {})
    assert result[0].first_earned_at == "2024-05-20T12:00:00Z"
    assert result[0].last_active_at == "2024-05-20T12:00:00Z"


# -- immutability -------------------------------------------------------------

def test_input_events_list_not_mutated():
    events = [
        _event("e1", "alice", PointSource.ACHIEVEMENT, 10, 1, "2024-01-01T00:00:00Z"),
        _event("e2", "bob", PointSource.GRADE, 5, 1, "2024-01-02T00:00:00Z"),
    ]
    original_ids = [e.id for e in events]
    aggregate_standings(events, {})
    assert [e.id for e in events] == original_ids

def test_member_standing_fields_are_frozen():
    import pytest
    s = MemberStanding(member_id="m1", total_points=10.0, nickname="M1")
    with pytest.raises(Exception):
        s.total_points = 999  # type: ignore[misc]
