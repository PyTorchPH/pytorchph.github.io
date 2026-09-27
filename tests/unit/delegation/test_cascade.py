from __future__ import annotations

from org_ops.delegation.cascade import CascadeOrchestrator
from org_ops.delegation.chopper import ResponsibilityChopper
from org_ops.delegation.models import Level


class _FakeLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        return schema(items=["r1"])


def test_build_drills_down_to_task_leaves():
    plan = {
        "root": {"children": ["Logistics"], "level": "exec", "owner_role": "Exec"},
        "root.Logistics": {
            "children": ["Venue"],
            "level": "director",
            "owner_role": "Director",
        },
        "root.Logistics.Venue": {
            "children": ["Book hall"],
            "level": "task",
            "owner_role": "JO",
        },
    }
    tree = CascadeOrchestrator(ResponsibilityChopper(_FakeLLM())).build(
        "Hackathon", plan
    )
    assert tree.nodes["root"].children == ["root.Logistics"]
    leaf = tree.nodes["root.Logistics.Venue.Book hall"]
    assert leaf.level == Level.TASK and leaf.is_leaf and leaf.owner_role == "JO"
    # every non-leaf has its children wired
    assert tree.nodes["root.Logistics"].children == ["root.Logistics.Venue"]
