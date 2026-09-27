"""Heuristic metric miner.

Scans a project's text (README, description) for number-bearing phrases that look
like measurable impact, and proposes them as *candidates*. Nothing here is
authoritative — every candidate is meant to be confirmed/edited/skipped by the
human before it lands in the CSV. Precision is less important than recall: a noisy
candidate is cheap to skip, a missed metric is lost.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..core.models import Repo

# Strong quantity units → high confidence (clearly a measurable count/rate).
_STRONG_UNITS = (
    "rows", "records", "users", "requests", "queries", "docs", "documents",
    "images", "samples", "tokens", "embeddings", "chunks", "params", "parameters",
    "epochs", "downloads", "stars", "commits", "tests", "lines",
    "req/s", "qps", "rps", "fps",
)
# A number with a magnitude suffix and/or a strong unit.
_MAGNITUDE = r"(?:k|m|b|bn|thousand|million|billion|gb|mb|tb|kb)"
_NUM = r"\d[\d,]*(?:\.\d+)?"

# Percentages and multipliers are almost always real metrics.
_RE_PERCENT = re.compile(rf"\b{_NUM}\s?%")
_RE_MULTIPLIER = re.compile(rf"\b{_NUM}\s?[x×]\b", re.IGNORECASE)
# Number + strong unit, e.g. "2.1M chunks", "8,500 rows", "1.2k users".
_RE_UNIT = re.compile(
    rf"\b{_NUM}\s?{_MAGNITUDE}?\s?(?P<unit>{'|'.join(_STRONG_UNITS)})\b",
    re.IGNORECASE,
)
# Bare scaled number, e.g. "2.1M", "8.5B" — weaker signal, flagged low-confidence.
_RE_SCALED = re.compile(rf"\b{_NUM}\s?{_MAGNITUDE}\b", re.IGNORECASE)


@dataclass(frozen=True)
class MetricCandidate:
    """A proposed metric awaiting human confirmation."""

    repo: str
    metric_label: str
    value: str
    context: str
    source: str  # "readme" | "description" | ...
    confidence: str  # "high" | "low"


def _context_window(line: str, limit: int = 90) -> str:
    return re.sub(r"\s+", " ", line).strip()[:limit]


def _label_from(line: str, match: re.Match[str], unit: str | None) -> str:
    """Best-effort metric label: the unit if we have one, else the words just
    before the number (often the noun the number quantifies)."""
    if unit:
        return unit.lower()
    before = line[: match.start()].strip()
    words = re.findall(r"[A-Za-z][A-Za-z/\-]+", before)
    return " ".join(words[-3:]).lower() if words else "metric"


def mine_text(repo: str, text: str, source: str = "readme") -> list[MetricCandidate]:
    """Extract metric candidates from a block of text, de-duplicated by value."""
    if not text:
        return []
    seen: set[str] = set()
    out: list[MetricCandidate] = []

    def add(value: str, label: str, line: str, confidence: str) -> None:
        norm = re.sub(r"\s+", "", value.lower())
        if norm in seen:
            return
        seen.add(norm)
        out.append(
            MetricCandidate(
                repo=repo,
                metric_label=label,
                value=re.sub(r"\s+", " ", value).strip(),
                context=_context_window(line),
                source=source,
                confidence=confidence,
            )
        )

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        for m in _RE_PERCENT.finditer(line):
            add(m.group(0), _label_from(line, m, None) or "rate", line, "high")
        for m in _RE_MULTIPLIER.finditer(line):
            add(m.group(0), _label_from(line, m, None) or "improvement", line, "high")
        for m in _RE_UNIT.finditer(line):
            add(m.group(0), _label_from(line, m, m.group("unit")), line, "high")
        for m in _RE_SCALED.finditer(line):
            add(m.group(0), _label_from(line, m, None), line, "low")

    return out


def mine_repo(repo: Repo) -> list[MetricCandidate]:
    """Mine a repo's README and description for metric candidates."""
    candidates: list[MetricCandidate] = []
    if repo.description:
        candidates.extend(mine_text(repo.name, repo.description, source="description"))
    if repo.readme:
        candidates.extend(mine_text(repo.name, repo.readme, source="readme"))
    # De-dupe across sources by value, preferring the first (description) hit.
    seen: set[str] = set()
    unique: list[MetricCandidate] = []
    for c in candidates:
        key = re.sub(r"\s+", "", c.value.lower())
        if key in seen:
            continue
        seen.add(key)
        unique.append(c)
    return unique
