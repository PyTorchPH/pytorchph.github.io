from __future__ import annotations

from abc import ABC, abstractmethod

from ..core.models import Evidence, RawDocument, Repo, Resume, RoleSpec


class Synthesizer(ABC):
    @abstractmethod
    def build(
        self,
        role: RoleSpec,
        repos: list[Repo],
        evidence: list[Evidence],
        documents: list[RawDocument],
    ) -> Resume:
        ...
