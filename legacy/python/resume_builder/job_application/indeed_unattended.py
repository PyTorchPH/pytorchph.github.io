"""Bounded unattended execution for explicit, pre-approved Indeed listings."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator, model_validator

from .batch import BatchApplicationTask
from .submission_history import (
    ApplicationSubmissionHistory,
    normalize_exact_identity,
)
from .salary_policy import JobLevel, SalaryBand

_INDEED_DETAIL_PATHS = frozenset({"/viewjob"})
_ALLOWED_TARGET_COUNTRIES = frozenset({"Philippines", "Australia", "Canada"})


class IndeedUnattendedJob(BaseModel):
    """One explicit Indeed listing with deterministic qualification constraints."""

    task_id: str
    company: str
    job_title: str
    listing_url: str
    target_country: str
    work_mode: str = "remote"
    resume_file: str = ""
    employment_type: str = ""
    job_level: JobLevel = JobLevel.UNKNOWN
    salary_signal: str = ""
    salary_monthly_min_php: int | None = None
    salary_monthly_max_php: int | None = None
    salary_band: SalaryBand = SalaryBand.UNKNOWN
    required_any_groups: list[list[str]] = Field(default_factory=list)
    blocked_terms: list[str] = Field(default_factory=list)

    @field_validator("listing_url")
    @classmethod
    def require_indeed_detail_url(cls, value: str) -> str:
        parts = urlsplit(value.strip())
        host = (parts.hostname or "").lower()
        if (
            parts.scheme != "https"
            or not (host == "indeed.com" or host.endswith(".indeed.com"))
            or parts.path.rstrip("/") not in _INDEED_DETAIL_PATHS
        ):
            raise ValueError("listing_url must be an HTTPS Indeed /viewjob URL")
        return value.strip()

    @field_validator("work_mode")
    @classmethod
    def require_remote(cls, value: str) -> str:
        if value != "remote":
            raise ValueError("unattended Indeed jobs must preserve work_mode=remote")
        return value

    @field_validator("target_country")
    @classmethod
    def require_approved_target_country(cls, value: str) -> str:
        country = value.strip()
        if country not in _ALLOWED_TARGET_COUNTRIES:
            raise ValueError(
                "unattended Indeed target_country must be Philippines, Australia, or Canada"
            )
        return country

    @field_validator("resume_file")
    @classmethod
    def require_plain_resume_filename(cls, value: str) -> str:
        if value and Path(value).name != value:
            raise ValueError("resume_file must be a filename within artifact_dir")
        return value

    @model_validator(mode="after")
    def require_country_specific_indeed_host(self) -> "IndeedUnattendedJob":
        host = (urlsplit(self.listing_url).hostname or "").lower()
        expected_host = {
            "Philippines": "ph.indeed.com",
            "Australia": "au.indeed.com",
            "Canada": "ca.indeed.com",
        }[self.target_country]
        if host != expected_host:
            raise ValueError(
                f"{self.target_country} candidates must use the {expected_host} listing host"
            )
        return self

    def batch_task(self) -> BatchApplicationTask:
        return BatchApplicationTask(
            task_id=self.task_id,
            company=self.company,
            job_title=self.job_title,
            domain=(urlsplit(self.listing_url).hostname or "").lower(),
            target_country=self.target_country,
            work_mode="remote",
            application_reference=f"{self.company} — {self.job_title}",
        )


class IndeedUnattendedManifest(BaseModel):
    jobs: list[IndeedUnattendedJob]

    @field_validator("jobs")
    @classmethod
    def require_unique_nonempty_jobs(
        cls, value: list[IndeedUnattendedJob]
    ) -> list[IndeedUnattendedJob]:
        if not value:
            raise ValueError("manifest must contain at least one job")
        task_ids = [item.task_id for item in value]
        if len(set(task_ids)) != len(task_ids):
            raise ValueError("manifest task_id values must be unique")
        return value


def description_is_allowed(
    description: str,
    *,
    required_any_groups: list[list[str]],
    blocked_terms: list[str],
) -> tuple[bool, str]:
    """Apply literal, auditable qualification rules without model inference."""
    normalized = normalize_exact_identity(description)
    if not normalized:
        return False, "job description is unavailable"
    for term in blocked_terms:
        clean_term = normalize_exact_identity(term)
        if clean_term and clean_term in normalized:
            return False, f"blocked qualification term is present: {term}"
    for group in required_any_groups:
        clean_group = [
            normalize_exact_identity(term) for term in group if normalize_exact_identity(term)
        ]
        if clean_group and not any(term in normalized for term in clean_group):
            return False, f"required qualification group is absent: {' | '.join(group)}"
    return True, "description passed deterministic qualification rules"


def has_recent_exact_submission(
    history: ApplicationSubmissionHistory,
    *,
    company: str,
    job_title: str,
    within_days: int = 30,
) -> bool:
    company_key = normalize_exact_identity(company)
    title_key = normalize_exact_identity(job_title)
    return any(
        normalize_exact_identity(entry.company) == company_key
        and normalize_exact_identity(entry.job_title) == title_key
        for entry in history.recent_submissions(within_days=within_days)
    )
