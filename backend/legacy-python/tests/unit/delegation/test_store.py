from __future__ import annotations

from org_ops.delegation.models import DelegationNode, DelegationTree, Level, NodeStatus
from org_ops.delegation.store import TreeStore


def _tree():
    t = DelegationTree(event="E")
    t.add(DelegationNode(id="a", level=Level.TASK))
    return t


def test_in_memory_roundtrip_and_status():
    s = TreeStore()
    s.save(_tree())
    s.update_status("E", "a", NodeStatus.DONE)
    loaded = s.load("E")
    assert loaded is not None and loaded.nodes["a"].status == NodeStatus.DONE


def test_json_file_persistence(tmp_path):
    s = TreeStore(path=tmp_path)
    s.save(_tree())
    again = TreeStore(path=tmp_path).load("E")  # fresh instance reads the file
    assert again is not None and "a" in again.nodes


def test_load_missing_returns_none():
    assert TreeStore().load("nope") is None
