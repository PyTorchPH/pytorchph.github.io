"""Provider-neutral contracts for job-market evidence."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

WorkMode = Literal["remote", "hybrid", "onsite", "any", "unknown"]


class JobMarketQuery(BaseModel):
    countries: list[str] = Field(default_factory=lambda: ["Philippines"])
    role_family: str = "software"
    work_mode: WorkMode = "any"
    days: int = Field(default=90, ge=7, le=730)

    @field_validator("countries")
    @classmethod
    def clean_countries(cls, values: list[str]) -> list[str]:
        cleaned = list(dict.fromkeys(" ".join(value.split()) for value in values if value.strip()))
        if not cleaned:
            raise ValueError("at least one country is required")
        return cleaned[:12]


class SourceStatus(BaseModel):
    id: str
    label: str
    kind: Literal["live_api", "annual_dataset", "official_series", "import"]
    configured: bool
    geography: str
    freshness: str
    attribution_url: str
    note: str = ""


class MarketPosting(BaseModel):
    id: str
    source: str
    company: str
    title: str
    country: str
    work_mode: WorkMode = "unknown"
    skills: list[str] = Field(default_factory=list)
    degree_requirement: Literal["completed", "in_progress_ok", "not_required", "unknown"] = (
        "unknown"
    )
    experience_min_years: float | None = None
    posted_at: str
    source_url: str = ""
    evidence_text: str = ""


class JobMarketSummary(BaseModel):
    query: JobMarketQuery
    generated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    snapshot_kind: Literal["live", "cached", "synthetic_demo"]
    sample_size: int
    unknown_degree_count: int
    unknown_experience_count: int
    sources: list[SourceStatus]
    hiring_layoff_series: list[dict[str, str | int | float | None]]
    skill_demand: list[dict[str, str | int | bool]]
    qualification_barriers: list[dict[str, str | int | float]]
    geography_ratios: list[dict[str, str | int | float]]
    personal_comparison: list[dict[str, str | int | bool]]
    salary_bands: list[dict[str, str | int]] = Field(default_factory=list)
    funnel: list[dict[str, str | int | float | None]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
