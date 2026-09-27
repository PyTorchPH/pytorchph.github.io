from __future__ import annotations

from org_ops.delegation.models import DelegationNode, DelegationTree, Level
from org_ops.delegation.requests import ChangeControlBoard, submit_drill_up


def _tree():
    t = DelegationTree(event="E")
    t.add(DelegationNode(id="root", level=Level.ROOT, children=["root.A"]))
    t.add(DelegationNode(id="root.A", level=Level.EXEC, responsibilities=["old"]))
    return t


def test_drill_up_request_records_idea():
    r = submit_drill_up("root.A.x", "root.A", "idea", "let's add a sponsor track")
    assert r.kind == "idea" and r.to_id == "root.A"


def test_ccb_approve_change_mutates_tree():
    ccb = ChangeControlBoard(_tree())
    req = ccb.submit("root.A", "root", "change", {"responsibilities": ["new"]})
    done = ccb.decide(req, approve=True)
    assert done.status == "approved"
    assert ccb.tree.nodes["root.A"].responsibilities == ["new"]


def test_ccb_reject_does_not_mutate():
    ccb = ChangeControlBoard(_tree())
    req = ccb.submit("root.A", "root", "change", {"responsibilities": ["new"]})
    done = ccb.decide(req, approve=False, reason="out of scope")
    assert done.status == "rejected" and done.reason == "out of scope"
    assert ccb.tree.nodes["root.A"].responsibilities == ["old"]  # unchanged


def test_ccb_approve_add_wires_child():
    ccb = ChangeControlBoard(_tree())
    req = ccb.submit("root.A.new", "root.A", "add",
                     {"id": "root.A.new", "level": "task", "title": "T", "owner_role": "JO"})
    done = ccb.decide(req, approve=True)
    assert done.status == "approved"
    assert "root.A.new" in ccb.tree.nodes
    assert "root.A.new" in ccb.tree.nodes["root.A"].children


def test_ccb_add_missing_parent_degrades_without_orphan():
    ccb = ChangeControlBoard(_tree())
    req = ccb.submit("x", "nope", "add", {"id": "x", "level": "task"})
    done = ccb.decide(req, approve=True)
    assert done.status == "rejected"
    assert "x" not in ccb.tree.nodes  # nothing orphaned


def test_ccb_change_missing_node_rejects_without_mutation():
    ccb = ChangeControlBoard(_tree())
    req = ccb.submit("nope", "root", "change", {"responsibilities": ["new"]})
    done = ccb.decide(req, approve=True)
    assert done.status == "rejected"
    assert ccb.tree.nodes["root.A"].responsibilities == ["old"]  # tree unchanged


def test_ccb_add_duplicate_id_rejects_preserving_original():
    ccb = ChangeControlBoard(_tree())
    req = ccb.submit("root.A", "root", "add", {"id": "root.A", "level": "exec"})
    done = ccb.decide(req, approve=True)
    assert done.status == "rejected"
    assert ccb.tree.nodes["root.A"].responsibilities == ["old"]  # original node intact
