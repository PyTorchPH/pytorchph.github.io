"""Tests for org_ops.points.growth."""
from __future__ import annotations
from org_ops.points.growth import (
    BracketOptions, difficulty_ceiling, gain, low_point_bracket, recommend_growth,
)
from org_ops.points.types import (
    Cluster, ClusterItem, GrowthAssessment, LeaderboardEntry,
)

def _a(member_id, activity_id, pretest, posttest):
    return GrowthAssessment(member_id=member_id, activity_id=activity_id,
                            pretest=pretest, posttest=posttest)

def _entry(member_id, rank, total_points=100):
    return LeaderboardEntry(member_id=member_id, rank=rank, total_points=total_points,
                            nickname=member_id, first_earned_at="2024-01-01T00:00:00Z",
                            last_active_at="2024-06-01T00:00:00Z")

def _item(id, cluster_id, difficulty, kind="lesson"):
    return ClusterItem(id=id, cluster_id=cluster_id, title=id, kind=kind, difficulty=difficulty)

# -- gain ---------------------------------------------------------------
def test_gain_positive():
    assert gain(_a("m","a",30,70)) == 40

def test_gain_zero():
    assert gain(_a("m","a",50,50)) == 0

def test_gain_negative():
    assert gain(_a("m","a",80,60)) == -20

def test_gain_fractional():
    assert abs(gain(_a("m","a",10.5,15.25)) - 4.75) < 1e-9

# -- difficulty_ceiling -----------------------------------------------
def test_ceiling_no_assessments():
    assert difficulty_ceiling([]) == 1

def test_ceiling_zero_gain():
    assert difficulty_ceiling([_a("m","a",50,50)]) == 1

def test_ceiling_negative_gain():
    assert difficulty_ceiling([_a("m","a",80,60)]) == 1

def test_ceiling_gain_4():
    assert difficulty_ceiling([_a("m","a",0,4)]) == 1

def test_ceiling_gain_5():
    assert difficulty_ceiling([_a("m","a",0,5)]) == 2

def test_ceiling_gain_10():
    assert difficulty_ceiling([_a("m","a",0,10)]) == 3

def test_ceiling_gain_15():
    assert difficulty_ceiling([_a("m","a",0,15)]) == 4

def test_ceiling_gain_20():
    assert difficulty_ceiling([_a("m","a",0,20)]) == 5

def test_ceiling_capped_at_5():
    assert difficulty_ceiling([_a("m","a",0,100)]) == 5

def test_ceiling_uses_best_gain():
    assessments = [_a("m","a1",0,3), _a("m","a2",0,15), _a("m","a3",0,8)]
    assert difficulty_ceiling(assessments) == 4

# -- low_point_bracket --------------------------------------------------
def test_bracket_empty():
    assert low_point_bracket([]) == set()

def test_bracket_default_half():
    board = [_entry("m1",1), _entry("m2",2), _entry("m3",3), _entry("m4",4)]
    assert low_point_bracket(board) == {"m3", "m4"}

def test_bracket_fraction_0_nobody():
    board = [_entry("m1",1), _entry("m2",2), _entry("m3",3)]
    assert low_point_bracket(board, BracketOptions(low_fraction=0.0)) == set()

def test_bracket_fraction_1_everybody():
    board = [_entry("m1",1), _entry("m2",2), _entry("m3",3)]
    assert low_point_bracket(board, BracketOptions(low_fraction=1.0)) == {"m1","m2","m3"}

def test_bracket_ceil_rounding():
    board = [_entry(f"m{i}",i) for i in range(1,6)]
    bracket = low_point_bracket(board, BracketOptions(low_fraction=0.4))
    assert bracket == {"m4", "m5"}

def test_bracket_odd_total_default_fraction():
    board = [_entry(f"m{i}",i) for i in range(1,6)]
    assert low_point_bracket(board) == {"m4", "m5"}

# -- recommend_growth ---------------------------------------------------
def _board_4():
    return [_entry("top",1,500), _entry("mid",2,300), _entry("low",3,100), _entry("bot",4,50)]

def _clusters_items():
    clusters = [Cluster(id="c1", name="Academics")]
    items = [_item("i1","c1",1), _item("i2","c1",3), _item("i3","c1",5)]
    return clusters, items

def test_recommend_only_low_bracket():
    board = _board_4()
    clusters, items = _clusters_items()
    recs = recommend_growth(board, {}, clusters, items)
    ids = {r.member_id for r in recs}
    assert "top" not in ids
    assert "mid" not in ids
    assert ids.issubset({"low", "bot"})

def test_recommend_no_assessments_defaults_ceiling_1():
    board = _board_4()
    clusters, items = _clusters_items()
    recs = recommend_growth(board, {}, clusters, items)
    for rec in recs:
        item = next(it for it in items if it.id == rec.cluster_item_id)
        assert item.difficulty == 1

def test_recommend_respects_ceiling():
    board = _board_4()
    clusters, items = _clusters_items()
    assessments = {"low": [_a("low","a1",0,10)]}  # gain 10 -> ceiling 3
    recs = recommend_growth(board, assessments, clusters, items)
    low_recs = [r for r in recs if r.member_id == "low"]
    assert len(low_recs) == 1
    item = next(it for it in items if it.id == low_recs[0].cluster_item_id)
    assert item.difficulty == 3

def test_recommend_picks_hardest_reachable():
    board = _board_4()
    clusters, items = _clusters_items()
    assessments = {"low": [_a("low","a1",0,20)]}  # gain 20 -> ceiling 5
    recs = recommend_growth(board, assessments, clusters, items)
    low_recs = [r for r in recs if r.member_id == "low"]
    item = next(it for it in items if it.id == low_recs[0].cluster_item_id)
    assert item.difficulty == 5

def test_recommend_skips_cluster_no_reachable():
    board = [_entry("low",2,10), _entry("top",1,100)]
    clusters = [Cluster(id="c1", name="Hard Only")]
    items = [_item("hard","c1",5)]
    assert recommend_growth(board, {}, clusters, items) == []

def test_recommend_reason_contains_kind_and_cluster():
    board = [_entry("low",2,10), _entry("top",1,100)]
    clusters = [Cluster(id="c1", name="Academics")]
    items = [_item("i1","c1",1,"hackathon")]
    recs = recommend_growth(board, {}, clusters, items)
    assert len(recs) == 1
    assert "hackathon" in recs[0].reason
    assert "Academics" in recs[0].reason

def test_recommend_never_mutates_ranks():
    board = _board_4()
    clusters, items = _clusters_items()
    ranks_before = [e.rank for e in board]
    recommend_growth(board, {}, clusters, items)
    assert [e.rank for e in board] == ranks_before

def test_recommend_empty_board():
    assert recommend_growth([], {}, [], []) == []

def test_recommend_multiple_clusters_one_rec_each():
    board = [_entry("low",2,10), _entry("top",1,100)]
    clusters = [Cluster(id="c1",name="A"), Cluster(id="c2",name="B")]
    items = [_item("ia","c1",1), _item("ib","c2",1)]
    recs = recommend_growth(board, {}, clusters, items)
    assert len(recs) == 2
    assert {r.cluster_item_id for r in recs} == {"ia", "ib"}
