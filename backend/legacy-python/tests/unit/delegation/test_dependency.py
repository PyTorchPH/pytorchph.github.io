from __future__ import annotations

from org_ops.delegation.dependency import (
    DependencyAnalyzer,
    blocked_nodes,
    independent_nodes,
)
from org_ops.delegation.models import (
    DelegationNode,
    DelegationTree,
    DependencyEdge,
    EdgeType,
    Level,
    NodeStatus,
)


class _FakeLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        return schema(items=[DependencyEdge(src="b", dst="a", kind=EdgeType.CROSS_SIBLING)])


def _tree():
    t = DelegationTree(event="E")
    t.add(DelegationNode(id="a", level=Level.TASK, status=NodeStatus.PENDING))
    t.add(DelegationNode(id="b", level=Level.TASK))
    return t


def test_suggest_returns_unconfirmed_edges():
    edges = DependencyAnalyzer(_FakeLLM()).suggest(_tree())
    assert edges[0].src == "b" and edges[0].dst == "a" and edges[0].confirmed is None


def test_blocked_and_independent_use_confirmed_edges_only():
    t = _tree()
    confirmed = [DependencyEdge(src="b", dst="a", kind=EdgeType.CROSS_SIBLING, confirmed=True)]
    # a is pending → b (which depends on a) is blocked; a has no incoming prereq → independent
    assert blocked_nodes(t, confirmed) == ["b"]
    assert independent_nodes(t, confirmed) == ["a"]
    # unconfirmed edges are ignored
    unconfirmed = [DependencyEdge(src="b", dst="a", kind=EdgeType.CROSS_SIBLING)]
    assert blocked_nodes(t, unconfirmed) == []
    assert set(independent_nodes(t, unconfirmed)) == {"a", "b"}


def test_suggest_returns_empty_on_llm_error():
    class _ErrorLLM:
        def structured(self, *a, **k):
            raise RuntimeError("network timeout")

    assert DependencyAnalyzer(_ErrorLLM()).suggest(_tree()) == []
