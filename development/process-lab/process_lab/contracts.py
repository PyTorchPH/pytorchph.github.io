from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class ServiceCheckResult:
    name: str
    ok: bool
    status_code: int | None = None
    detail: str = ""
    artifact: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class BrowserJourneyResult:
    name: str
    final_url: str
    assertions: dict[str, bool] = field(default_factory=dict)
    trace_path: str | None = None

    @property
    def ok(self) -> bool:
        return bool(self.assertions) and all(self.assertions.values())

    def as_dict(self) -> dict[str, Any]:
        return {**asdict(self), "ok": self.ok}
