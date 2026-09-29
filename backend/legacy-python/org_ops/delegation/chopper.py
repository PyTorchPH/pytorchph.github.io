from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel, Field

from resume_builder.llm.base import LLMProvider

from .models import DelegationNode, Level

log = logging.getLogger(__name__)

_SYSTEM = (
    "You break a parent responsibility into concrete responsibilities for ONE child unit "
    "(department, field, or task owner) in a student-org delegation tree. Be specific and "
    "action-oriented; return only this child's responsibilities. No numbering, no preamble."
)


class _Responsibilities(BaseModel):
    items: list[str] = Field(default_factory=list)


class ResponsibilityChopper:
    """Per-level AI breakdown: one parallel LLM call per child. Never raises."""

    def __init__(self, llm: LLMProvider, max_workers: int = 6) -> None:
        self._llm = llm
        self._max_workers = max(1, max_workers)

    def _one(
        self,
        parent: DelegationNode,
        title: str,
        child_level: Level,
        owner_role: str,
    ) -> DelegationNode:
        items: list[str] = []
        try:
            prompt = (
                f"Event/parent: {parent.title}\nParent responsibilities: {parent.responsibilities}\n"
                f"Child unit: {title} (level={child_level.value})\n\n"
                "List this child's responsibilities."
            )
            resp = self._llm.structured(prompt, schema=_Responsibilities, system=_SYSTEM, max_tokens=1024)
            items = list(resp.items)
        except Exception as exc:  # noqa: BLE001 — a failed child degrades to empty, never breaks the batch
            log.warning("chop failed for %s/%s: %s", parent.id, title, exc)
            items = []
        try:
            return DelegationNode(
                id=f"{parent.id}.{title}", level=child_level, owner_role=owner_role,
                title=title, responsibilities=items,
            )
        except Exception as exc:  # noqa: BLE001 — node construction must never escape the worker
            log.error("node construction failed for %s/%s: %s", parent.id, title, exc)
            return DelegationNode(
                id=f"{parent.id}.{title}", level=child_level, owner_role=owner_role,
                title=title, responsibilities=[],
            )

    def chop(
        self,
        parent: DelegationNode,
        child_titles: list[str],
        child_level: Level,
        owner_role: str,
    ) -> list[DelegationNode]:
        if not child_titles:
            return []
        with ThreadPoolExecutor(max_workers=self._max_workers) as pool:
            results = list(
                pool.map(
                    lambda t: self._one(parent, t, child_level, owner_role), child_titles
                )
            )
        return results  # pool.map preserves input order
