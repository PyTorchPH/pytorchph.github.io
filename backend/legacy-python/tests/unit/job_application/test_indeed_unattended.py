from pathlib import Path

import pytest
from pydantic import ValidationError

from resume_builder.job_application.indeed_unattended import (
    IndeedUnattendedJob,
    IndeedUnattendedManifest,
    description_is_allowed,
)


def _job(**overrides) -> IndeedUnattendedJob:
    values = {
        "task_id": "job-1",
        "company": "Example",
        "job_title": "AI Intern",
        "listing_url": "https://au.indeed.com/viewjob?jk=abc",
        "target_country": "Australia",
        "work_mode": "remote",
        "resume_file": "ai-ml-research.pdf",
    }
    values.update(overrides)
    return IndeedUnattendedJob.model_validate(values)


def test_job_accepts_explicit_remote_indeed_detail() -> None:
    job = _job()

    assert job.batch_task().domain == "au.indeed.com"
    assert job.batch_task().work_mode == "remote"


def test_job_accepts_philippines_indeed_host() -> None:
    job = _job(
        listing_url="https://ph.indeed.com/viewjob?jk=abc",
        target_country="Philippines",
    )

    assert job.batch_task().domain == "ph.indeed.com"
    assert job.target_country == "Philippines"


@pytest.mark.parametrize(
    "overrides",
    [
        {"listing_url": "https://company.example/jobs/1"},
        {"listing_url": "https://au.indeed.com/jobs?q=ai"},
        {"target_country": "Philippines"},
        {"target_country": "Canada"},
        {"work_mode": "any"},
        {"resume_file": str(Path("nested") / "resume.pdf")},
    ],
)
def test_job_rejects_scope_broadening(overrides: dict[str, str]) -> None:
    with pytest.raises(ValidationError):
        _job(**overrides)


def test_manifest_requires_unique_tasks() -> None:
    with pytest.raises(ValidationError, match="unique"):
        IndeedUnattendedManifest(jobs=[_job(), _job()])


def test_description_rules_require_each_group_and_reject_blocked_term() -> None:
    allowed, reason = description_is_allowed(
        "Remote AI internship using Python and machine learning.",
        required_any_groups=[["intern", "graduate"], ["machine learning", "llm"]],
        blocked_terms=["must reside in Australia"],
    )
    assert allowed
    assert "passed" in reason

    allowed, reason = description_is_allowed(
        "Remote AI internship. Applicants must reside in Australia.",
        required_any_groups=[["intern"], ["ai"]],
        blocked_terms=["must reside in Australia"],
    )
    assert not allowed
    assert "blocked" in reason
