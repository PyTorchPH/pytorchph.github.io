from __future__ import annotations

from typing import Literal

from .models import ChangeRequest, DelegationNode, DelegationTree, DrillUpRequest, Level


def submit_drill_up(from_id: str, to_id: str, kind: Literal["idea", "problem"],
                    message: str) -> DrillUpRequest:
    """Upward request: a node escalates an idea or a problem to a higher node."""
    return DrillUpRequest(from_id=from_id, to_id=to_id, kind=kind, message=message)


class ChangeControlBoard:
    """Any change/add from below routes to the parent for approval before it mutates the tree. Versioning/audit of approved changes lands with the Supabase-backed store (deferred); this in-memory board mutates the tree in place."""

    def __init__(self, tree: DelegationTree) -> None:
        self.tree = tree

    def submit(self, node_id: str, parent_id: str, kind: Literal["change", "add"],
               payload: dict) -> ChangeRequest:
        return ChangeRequest(node_id=node_id, parent_id=parent_id, kind=kind, payload=payload)

    def decide(self, req: ChangeRequest, approve: bool, reason: str = "") -> ChangeRequest:
        if not approve:
            return req.model_copy(update={"status": "rejected", "reason": reason})
        if req.kind == "change":
            node = self.tree.nodes.get(req.node_id)
            if node is None or "responsibilities" not in req.payload:
                return req.model_copy(update={
                    "status": "rejected",
                    "reason": "change requires an existing node and a 'responsibilities' payload",
                })
            node.responsibilities = list(req.payload["responsibilities"])
        elif req.kind == "add":
            node_id = req.payload.get("id")
            parent = self.tree.nodes.get(req.parent_id)
            if not node_id or parent is None:
                return req.model_copy(update={
                    "status": "rejected",
                    "reason": "add requires a valid 'id' payload and an existing parent",
                })
            if node_id in self.tree.nodes:
                return req.model_copy(update={
                    "status": "rejected",
                    "reason": "add target id already exists",
                })
            new = DelegationNode(
                id=node_id, level=Level(req.payload.get("level", "task")),
                title=req.payload.get("title", ""), owner_role=req.payload.get("owner_role", ""),
            )
            self.tree.add(new)
            if new.id not in parent.children:
                parent.children.append(new.id)
        return req.model_copy(update={"status": "approved", "reason": reason})
