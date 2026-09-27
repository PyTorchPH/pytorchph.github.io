from __future__ import annotations

from org_ops.delegation.chopper import ResponsibilityChopper
from org_ops.delegation.models import DelegationNode, Level


class _FakeLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        return schema(items=["draft agenda", "book venue"])


def test_chop_returns_one_node_per_child_with_responsibilities():
    parent = DelegationNode(id="root", level=Level.ROOT, title="Event")
    out = ResponsibilityChopper(_FakeLLM()).chop(
        parent, child_titles=["Logistics", "Marketing"], child_level=Level.EXEC, owner_role="Exec")
    assert [n.id for n in out] == ["root.Logistics", "root.Marketing"]
    assert all(n.level == Level.EXEC and n.owner_role == "Exec" for n in out)
    assert out[0].responsibilities == ["draft agenda", "book venue"]


def test_chop_degrades_on_llm_error():
    class _Boom:
        def structured(self, *a, **k):
            raise RuntimeError("down")

    out = ResponsibilityChopper(_Boom()).chop(
        DelegationNode(id="r", level=Level.ROOT), ["A"], Level.EXEC, "Exec")
    assert out[0].responsibilities == [] and out[0].id == "r.A"
    assert out[0].level == Level.EXEC and out[0].owner_role == "Exec"


def test_chop_empty_titles_returns_empty():
    out = ResponsibilityChopper(_FakeLLM()).chop(
        DelegationNode(id="r", level=Level.ROOT), [], Level.EXEC, "Exec")
    assert out == []
