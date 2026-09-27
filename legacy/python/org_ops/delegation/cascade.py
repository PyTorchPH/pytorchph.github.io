from __future__ import annotations

from collections import deque

from .chopper import ResponsibilityChopper
from .models import DelegationNode, DelegationTree, Level


class CascadeOrchestrator:
    """Drill-down: chop each node into its children, level by level, down to JO task leaves."""

    def __init__(self, chopper: ResponsibilityChopper) -> None:
        self._chopper = chopper

    def build(self, event: str, plan: dict) -> DelegationTree:
        tree = DelegationTree(event=event)
        root = DelegationNode(id="root", level=Level.ROOT, title=event)
        tree.add(root)
        queue: deque[str] = deque(["root"])
        while queue:
            node_id = queue.popleft()
            spec = plan.get(node_id)
            if not spec:  # no expansion plan → leaf
                continue
            child_level = Level(spec["level"])
            children = self._chopper.chop(
                tree.nodes[node_id],
                spec["children"],
                child_level,
                spec["owner_role"],
            )
            tree.nodes[node_id].children = [c.id for c in children]
            for c in children:
                tree.add(c)
                if not c.is_leaf:
                    queue.append(c.id)
        return tree
