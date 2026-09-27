from __future__ import annotations

from org_ops.delegation.models import (
    DelegationNode,
    DelegationTree,
    DependencyEdge,
    Level,
    NodeStatus,
)


def test_node_leaf_and_contract():
    n = DelegationNode(
        id="d.f.t", level=Level.TASK, owner_role="JO", title="Do X", responsibilities=["x"]
    )
    assert n.is_leaf is True
    c = n.to_contract()
    assert c["id"] == "d.f.t" and c["responsibilities"] == ["x"] and "agreement" not in c


def test_tree_children_and_defaults():
    t = DelegationTree(event="Hackathon")
    root = DelegationNode(id="root", level=Level.ROOT, children=["a"])
    a = DelegationNode(id="a", level=Level.EXEC)
    t.add(root)
    t.add(a)
    assert [n.id for n in t.children_of("root")] == ["a"]
    assert a.status == NodeStatus.PENDING and a.agreement.signed_by is None


def test_dependency_edge_unconfirmed_by_default():
    e = DependencyEdge(src="a", dst="b", kind="cross_sibling")  # type: ignore[arg-type]
    assert e.confirmed is None
