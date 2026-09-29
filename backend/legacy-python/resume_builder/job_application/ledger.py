"""Small durable idempotency ledger for application submissions."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

from pydantic import BaseModel


class LedgerState(str, Enum):
    DRAFT = "draft"
    AWAITING_PERMISSION = "awaiting_permission"
    SUBMITTING = "submitting"
    SUBMITTED = "submitted"
    FAILED = "failed"
    SUBMISSION_UNKNOWN = "submission_unknown"


class LedgerEntry(BaseModel):
    application_id: str
    state: LedgerState
    updated_at: str
    confirmation: str = ""


class ApplicationLedger:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def get(self, application_id: str) -> LedgerEntry | None:
        payload = self._load()
        value = payload.get(application_id)
        return LedgerEntry.model_validate(value) if value else None

    def set(self, application_id: str, state: LedgerState, confirmation: str = "") -> LedgerEntry:
        payload = self._load()
        entry = LedgerEntry(
            application_id=application_id,
            state=state,
            updated_at=datetime.now(timezone.utc).isoformat(),
            confirmation=confirmation,
        )
        payload[application_id] = entry.model_dump(mode="json")
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        temporary.replace(self.path)
        return entry

    def _load(self) -> dict:
        if not self.path.exists():
            return {}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}
