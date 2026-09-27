from __future__ import annotations

from org_ops.delegation.chopper import ResponsibilityChopper
from org_ops.delegation.models import DelegationNode, Level
from org_ops.delegation.review import LevelReview


class _FakeLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        return schema(items=["corrected item"] if "CORRECTION" in prompt else ["orig"])


def _parent():
    return DelegationNode(id="root", level=Level.ROOT, title="Event")


def test_approve_passes_children_through():
    review = LevelReview(ResponsibilityChopper(_FakeLLM()))
    kids = [DelegationNode(id="root.A", level=Level.EXEC)]
    verdict, out = review.review(_parent(), kids, "approve", Level.EXEC, "Exec")
    assert verdict == "approved" and out == kids


def test_correct_rechops_only_this_subtree_with_correction():
    review = LevelReview(ResponsibilityChopper(_FakeLLM()))
    kids = [DelegationNode(id="root.A", level=Level.EXEC, title="A")]
    verdict, out = review.review(_parent(), kids, "correct", Level.EXEC, "Exec",
                                 correction="add CORRECTION")
    assert verdict == "rechopped"
    assert out[0].responsibilities == ["corrected item"]  # the correction reached the chopper
