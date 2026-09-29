from __future__ import annotations

from .chopper import ResponsibilityChopper
from .models import DelegationNode, Level


class LevelReview:
    """HITL gate: approve the AI proposal, or correct it (re-chop only this subtree)."""

    def __init__(self, chopper: ResponsibilityChopper) -> None:
        self._chopper = chopper

    def review(
        self,
        parent: DelegationNode,
        children: list[DelegationNode],
        decision: str,
        child_level: Level,
        owner_role: str,
        correction: str = "",
    ) -> tuple[str, list[DelegationNode]]:
        if decision == "approve":
            return "approved", children
        # correct → fold the correction into the parent context and re-chop ONLY this subtree
        amended = parent.model_copy(update={
            "responsibilities": [*parent.responsibilities, f"CORRECTION: {correction}"],
        })
        titles = [c.title or c.id.rsplit(".", 1)[-1] for c in children]
        return "rechopped", self._chopper.chop(amended, titles, child_level, owner_role)
