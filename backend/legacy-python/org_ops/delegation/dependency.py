from __future__ import annotations

from pydantic import BaseModel, Field

from resume_builder.llm.base import LLMProvider

from .models import DelegationTree, DependencyEdge, NodeStatus

_SYSTEM = (
    "You analyze a delegation tree and SUGGEST prerequisite dependencies between units: "
    "cross_sibling (dept/field needs another's output), parent_child (level needs the level above), "
    "and intra_node (a task needs another task in the same unit). Return edges as src depends on dst "
    "(dst is the prerequisite). This is a SUGGESTION for human review, not final."
)


class _EdgeList(BaseModel):
    items: list[DependencyEdge] = Field(default_factory=list)


class DependencyAnalyzer:
    """AI-suggested prerequisite overlay (separate layer; humans checkmark each edge)."""

    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    def suggest(self, tree: DelegationTree) -> list[DependencyEdge]:
        listing = "\n".join(f"{n.id} ({n.level.value}): {n.title}" for n in tree.nodes.values())
        prompt = f"Event: {tree.event}\nNodes:\n{listing}\n\nReturn suggested dependency edges."
        try:
            result = self._llm.structured(prompt, schema=_EdgeList, system=_SYSTEM, max_tokens=1024)
            return [e.model_copy(update={"confirmed": None}) for e in result.items]
        except Exception:  # noqa: BLE001 — any LLM/parse failure yields no suggestions
            return []


def confirmed_edges(edges: list[DependencyEdge]) -> list[DependencyEdge]:
    return [e for e in edges if e.confirmed is True]


def blocked_nodes(tree: DelegationTree, edges: list[DependencyEdge]) -> list[str]:
    """Nodes with a CONFIRMED prerequisite (dst) that is not done yet."""
    out: list[str] = []
    for e in confirmed_edges(edges):
        dst = tree.nodes.get(e.dst)
        if dst is not None and dst.status != NodeStatus.DONE and e.src not in out:
            out.append(e.src)
    return out


def independent_nodes(tree: DelegationTree, edges: list[DependencyEdge]) -> list[str]:
    """Nodes with no CONFIRMED incoming prerequisite — safe side-tasks to do anytime."""
    has_prereq = {e.src for e in confirmed_edges(edges)}
    return [nid for nid in tree.nodes if nid not in has_prereq]
