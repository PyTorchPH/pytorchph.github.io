from __future__ import annotations

from abc import ABC, abstractmethod

from ..core.models import Evidence, Repo, RoleSpec


class Extractor(ABC):
    @abstractmethod
    def extract(self, repos: list[Repo], role: RoleSpec) -> list[Evidence]:
        """Score and filter repos by role relevance. Return Evidence sorted by score desc."""
