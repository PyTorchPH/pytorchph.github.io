from __future__ import annotations

import json
from pathlib import Path

from ..core.models import RoleSpec
from .base import RoleNotFoundError, RolePicker


class StaticRolePicker(RolePicker):
    def __init__(self, roles_path: Path) -> None:
        self._roles_path = roles_path
        self._roles = self._load(roles_path)

    @staticmethod
    def _load(path: Path) -> dict[str, RoleSpec]:
        data = json.loads(path.read_text(encoding="utf-8"))
        out: dict[str, RoleSpec] = {}
        for raw in data.get("roles", []):
            spec = RoleSpec.model_validate(raw)
            out[spec.id] = spec
        return out

    def list_available(self) -> list[RoleSpec]:
        return list(self._roles.values())

    def pick(self, selection: str) -> RoleSpec:
        if selection in self._roles:
            return self._roles[selection]
        raise RoleNotFoundError(
            f"Role id {selection!r} not found in {self._roles_path}. "
            f"Available: {sorted(self._roles)}"
        )
