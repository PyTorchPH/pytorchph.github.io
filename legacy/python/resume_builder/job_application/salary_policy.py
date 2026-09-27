"""Deterministic salary and early-career classification for application quotas."""

from __future__ import annotations

import re
from enum import Enum

from pydantic import BaseModel


class SalaryBand(str, Enum):
    BELOW_20K = "below_20k"
    PHP_20K_40K = "php_20k_40k"
    PHP_40K_80K = "php_40k_80k"
    PHP_80K_PLUS = "php_80k_plus"
    UNKNOWN = "unknown"
    LEGACY = "legacy_unclassified"


class JobLevel(str, Enum):
    INTERN = "intern"
    JUNIOR = "junior"
    UNKNOWN = "unknown"


DEFAULT_SALARY_TARGET_MIX: dict[SalaryBand, int] = {
    SalaryBand.BELOW_20K: 35,
    SalaryBand.PHP_20K_40K: 50,
    SalaryBand.PHP_40K_80K: 10,
    SalaryBand.PHP_80K_PLUS: 5,
}

_TIE_ORDER = (
    SalaryBand.PHP_20K_40K,
    SalaryBand.BELOW_20K,
    SalaryBand.PHP_40K_80K,
    SalaryBand.PHP_80K_PLUS,
)
_PHP_MARKER = re.compile(r"(?:₱|php\s*)", re.I)
_AMOUNT = r"(\d[\d,]*(?:\.\d+)?)\s*([km])?"
_RANGE = re.compile(_AMOUNT + r"\s*(?:-|–|—|to)\s*(?:₱|php\s*)?" + _AMOUNT, re.I)
_SINGLE = re.compile(_AMOUNT, re.I)
_ANNUAL = re.compile(r"(?:per\s+year|a\s+year|annual|annum|yearly)", re.I)
_MONTHLY = re.compile(r"(?:per\s+month|a\s+month|monthly|/\s*month|/\s*mo\b)", re.I)
_UNSUPPORTED_PERIOD = re.compile(
    r"(?:per\s+(?:hour|day|week)|an\s+hour|daily|weekly|/\s*(?:hr|day|wk))", re.I
)


class SalaryEvidence(BaseModel):
    raw: str = ""
    monthly_min_php: int | None = None
    monthly_max_php: int | None = None
    band: SalaryBand = SalaryBand.UNKNOWN
    reason: str = "salary unavailable"


def allocate_salary_targets(
    target: int,
    mix: dict[SalaryBand | str, int] | None = None,
) -> dict[SalaryBand, int]:
    """Allocate whole slots by largest remainder with a stable product-priority tie break."""
    if target < 1:
        raise ValueError("target must be at least 1")
    normalized = {
        SalaryBand(key): int(value) for key, value in (mix or DEFAULT_SALARY_TARGET_MIX).items()
    }
    if set(normalized) != set(DEFAULT_SALARY_TARGET_MIX) or sum(normalized.values()) != 100:
        raise ValueError("salary_target_mix must define the four known bands and total 100")
    if any(value < 0 for value in normalized.values()):
        raise ValueError("salary_target_mix percentages cannot be negative")
    exact = {band: target * percent / 100 for band, percent in normalized.items()}
    allocated = {band: int(value) for band, value in exact.items()}
    remaining = target - sum(allocated.values())
    tie_index = {band: index for index, band in enumerate(_TIE_ORDER)}
    ranked = sorted(
        normalized,
        key=lambda band: (-(exact[band] - allocated[band]), tie_index[band]),
    )
    for band in ranked[:remaining]:
        allocated[band] += 1
    return allocated


def classify_monthly_salary(value: int | None) -> SalaryBand:
    if value is None or value < 0:
        return SalaryBand.UNKNOWN
    if value < 20_000:
        return SalaryBand.BELOW_20K
    if value < 40_000:
        return SalaryBand.PHP_20K_40K
    if value < 80_000:
        return SalaryBand.PHP_40K_80K
    return SalaryBand.PHP_80K_PLUS


def parse_salary_signal(value: str | None) -> SalaryEvidence:
    raw = " ".join((value or "").split())
    if not raw:
        return SalaryEvidence()
    if not _PHP_MARKER.search(raw):
        return SalaryEvidence(raw=raw, reason="salary is not explicitly denominated in PHP")
    if _UNSUPPORTED_PERIOD.search(raw):
        return SalaryEvidence(
            raw=raw, reason="hourly, daily, or weekly salary lacks a safe monthly schedule"
        )
    annual = bool(_ANNUAL.search(raw))
    if not annual and not _MONTHLY.search(raw):
        return SalaryEvidence(raw=raw, reason="salary period is not explicitly monthly or annual")
    match = _RANGE.search(raw)
    if match:
        minimum = _amount(match.group(1), match.group(2))
        maximum = _amount(match.group(3), match.group(4))
    else:
        match = _SINGLE.search(_PHP_MARKER.sub("", raw, count=1))
        if not match:
            return SalaryEvidence(raw=raw, reason="salary amount could not be parsed")
        minimum = maximum = _amount(match.group(1), match.group(2))
    if minimum > maximum:
        minimum, maximum = maximum, minimum
    if annual:
        minimum, maximum = round(minimum / 12), round(maximum / 12)
    return SalaryEvidence(
        raw=raw,
        monthly_min_php=minimum,
        monthly_max_php=maximum,
        band=classify_monthly_salary(minimum),
        reason="classified from the disclosed minimum monthly PHP salary",
    )


def classify_job_level(title: str, experience_level: str | None = None) -> JobLevel:
    evidence = " ".join((title, experience_level or "")).casefold()
    if re.search(r"\b(intern|internship|ojt|trainee)\b", evidence):
        return JobLevel.INTERN
    if re.search(r"\b(junior|entry[ -]?level|graduate|new grad|associate)\b", evidence):
        return JobLevel.JUNIOR
    return JobLevel.UNKNOWN


def _amount(number: str, suffix: str | None) -> int:
    value = float(number.replace(",", ""))
    if (suffix or "").casefold() == "k":
        value *= 1_000
    elif (suffix or "").casefold() == "m":
        value *= 1_000_000
    return round(value)
