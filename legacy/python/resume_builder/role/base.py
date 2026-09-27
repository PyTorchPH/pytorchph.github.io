from __future__ import annotations

from abc import ABC, abstractmethod

from ..core.models import RoleSpec


class RoleNotFoundError(LookupError):
    pass


class RolePicker(ABC):
    @abstractmethod
    def pick(self, selection: str) -> RoleSpec:
        """Return a RoleSpec for `selection` (id for static, free-form prompt for AI)."""

    def list_available(self) -> list[RoleSpec]:
        """Optional: list roles a user can pick from. Static returns config; AI returns []."""
        return []
