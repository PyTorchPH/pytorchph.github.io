"""Aggregate usage counters: resume downloads and pages scraped.

Intentionally tiny. There is no per-user breakdown and no PII here — just two
running totals the frontend bumps by +1 (or +N for pages). The on-disk form is a
single small JSON object so it is trivial to read, serve, and reset.

    {"downloads": 1240, "pages_scraped": 9831}

KNOWN LIMITATION — RACE CONDITION (accepted for now)
----------------------------------------------------
`increment()` is a read-modify-write: it loads the JSON, adds to a field, and
writes it back. If two requests increment at the same time, both can read the
same starting value and one update is lost (a classic lost-update race). This is
acceptable today because the product is frontend-only with no backend compute to
serialize writes; under low concurrency the drift is negligible.

The concurrency-safe fix (atomic DB increment / file lock / append-only event
log) is tracked in the GitHub Projects backlog:
"Make usage counters concurrency-safe (atomic increment)". Do not paper over this
silently — the limitation is documented here on purpose.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, Field, NonNegativeInt

# Repo-root/out/usage-counters.json by default; callers may override the path.
_PROJECT_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_COUNTERS_PATH = _PROJECT_ROOT / "out" / "usage-counters.json"

# The only fields a caller may bump. Guards against arbitrary attribute writes.
COUNTER_FIELDS = ("downloads", "pages_scraped")


class UsageCounters(BaseModel):
    """Two aggregate totals. New fields default to 0 so old files stay readable."""

    downloads: NonNegativeInt = Field(0, description="Total resume downloads/exports.")
    pages_scraped: NonNegativeInt = Field(0, description="Total pages scraped across all crawls.")


def read_counters(path: str | Path = DEFAULT_COUNTERS_PATH) -> UsageCounters:
    """Load the counters. A missing or unreadable file reads as all-zero."""
    p = Path(path)
    if not p.is_file():
        return UsageCounters()
    try:
        return UsageCounters.model_validate_json(p.read_text(encoding="utf-8"))
    except Exception:
        # A corrupt counter file must not take down the page; start fresh.
        return UsageCounters()


def increment(
    field: str,
    by: int = 1,
    path: str | Path = DEFAULT_COUNTERS_PATH,
) -> UsageCounters:
    """Add `by` to one counter and persist. Returns the updated counters.

    NOT concurrency-safe — see the module docstring. `by` must be >= 0 and
    `field` must be one of COUNTER_FIELDS.
    """
    if field not in COUNTER_FIELDS:
        raise ValueError(f"unknown counter field {field!r}; expected one of {COUNTER_FIELDS}")
    if by < 0:
        raise ValueError("counters only move forward; `by` must be >= 0")
    counters = read_counters(path)
    updated = counters.model_copy(update={field: getattr(counters, field) + by})
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(updated.model_dump_json(indent=2), encoding="utf-8")
    return updated


def bump_download(path: str | Path = DEFAULT_COUNTERS_PATH) -> UsageCounters:
    """Convenience: +1 download."""
    return increment("downloads", 1, path)


def add_pages_scraped(count: int, path: str | Path = DEFAULT_COUNTERS_PATH) -> UsageCounters:
    """Convenience: +N pages scraped."""
    return increment("pages_scraped", count, path)
