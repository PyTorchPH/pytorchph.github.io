"""Redaction helpers for application traces and audit events."""

from __future__ import annotations

import re

_EMAIL = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
_PHONE = re.compile(r"(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)")


def redact(value: str, *, limit: int = 500) -> str:
    text = _EMAIL.sub("[REDACTED_EMAIL]", value or "")
    text = _PHONE.sub("[REDACTED_PHONE]", text)
    return text[:limit]
