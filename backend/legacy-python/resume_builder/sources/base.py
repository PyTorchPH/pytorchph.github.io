"""Abstract source collector. New sources (GitLab, Bitbucket, ...) subclass this."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class SourceCollector(ABC):
    name: str = "abstract"

    @abstractmethod
    def collect(self, **kwargs: Any) -> Any:
        """Implementation-specific. See concrete classes for return types."""
