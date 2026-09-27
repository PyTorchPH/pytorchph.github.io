from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class Level(str, Enum):
    ROOT = "root"
    EXEC = "exec"
    DIRECTOR = "director"
    TASK = "task"


class NodeStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class EdgeType(str, Enum):
    CROSS_SIBLING = "cross_sibling"
    PARENT_CHILD = "parent_child"
    INTRA_NODE = "intra_node"


class Agreement(BaseModel):
    signed_by: str | None = None
    e_signature: str | None = None
    signed_at: str | None = None  # ISO timestamp


class DelegationNode(BaseModel):
    id: str
    level: Level
    owner_role: str = ""
    title: str = ""
    responsibilities: list[str] = Field(default_factory=list)
    children: list[str] = Field(default_factory=list)
    status: NodeStatus = NodeStatus.PENDING
    agreement: Agreement = Field(default_factory=Agreement)

    @property
    def is_leaf(self) -> bool:
        return self.level == Level.TASK

    def to_contract(self) -> dict:
        """The checked-by-parent JSON handed to the level below (no agreement state). This IS the DelegationPackager step — the checked-by-parent JSON contract handed to the level below."""
        return {
            "id": self.id, "level": self.level.value, "owner_role": self.owner_role,
            "title": self.title, "responsibilities": list(self.responsibilities),
            "children": list(self.children),
        }


class DependencyEdge(BaseModel):
    src: str
    dst: str               # src depends on dst (dst is the prerequisite)
    kind: EdgeType
    confirmed: bool | None = None  # human checkmark: None=unreviewed, True/False=verdict


class DrillUpRequest(BaseModel):
    from_id: str
    to_id: str
    kind: Literal["idea", "problem"]
    message: str


class ChangeRequest(BaseModel):
    node_id: str
    parent_id: str
    kind: Literal["change", "add"]
    payload: dict = Field(default_factory=dict)
    status: Literal["pending", "approved", "rejected"] = "pending"
    reason: str = ""


class DelegationTree(BaseModel):
    event: str
    nodes: dict[str, DelegationNode] = Field(default_factory=dict)
    edges: list[DependencyEdge] = Field(default_factory=list)

    def add(self, node: DelegationNode) -> None:
        self.nodes[node.id] = node

    def children_of(self, node_id: str) -> list[DelegationNode]:
        parent = self.nodes.get(node_id)
        if parent is None:
            return []
        return [self.nodes[c] for c in parent.children if c in self.nodes]
