"""Website-agnostic command boundary for application-goal cycles."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .goal_store import ApplicationGoal


@dataclass(frozen=True)
class SiteCycleRequest:
    root: Path
    goal: ApplicationGoal
    manifest_path: Path
    inventory_report_path: Path
    attempted_task_ids_path: Path
    artifact_dir: Path
    database: Path
    queue: Path
    output: Path
    cdp_url: str
    candidate_limit: int
    max_parallel: int


class ApplicationSiteRuntimeAdapter(Protocol):
    site_id: str

    def collect_command(self, request: SiteCycleRequest) -> list[str]: ...

    def run_command(self, request: SiteCycleRequest) -> list[str]: ...


class IndeedRuntimeAdapter:
    site_id = "indeed"

    def collect_command(self, request: SiteCycleRequest) -> list[str]:
        command = [
            sys.executable,
            str(request.root / "tools/job_finder/collect_indeed_candidates.py"),
            "--cdp-url",
            request.cdp_url,
            "--database",
            str(request.database),
            "--goal-id",
            request.goal.id,
            "--max-candidates",
            str(request.candidate_limit),
            "--exclude-task-ids",
            str(request.attempted_task_ids_path),
            "--output",
            str(request.manifest_path),
            "--inventory-output",
            str(request.inventory_report_path),
            "--queue",
            str(request.queue),
            "--current-search-only",
            "--max-pages",
            "3",
        ]
        for employment_type in request.goal.employment_types:
            command.extend(["--employment-type", employment_type])
        for job_level in request.goal.job_levels:
            command.extend(["--job-level", job_level.value])
        for country in request.goal.target_countries:
            command.extend(["--target-country", country])
        return command

    def run_command(self, request: SiteCycleRequest) -> list[str]:
        return [
            sys.executable,
            str(request.root / "tools/job_finder/run_indeed_unattended.py"),
            "--manifest",
            str(request.manifest_path),
            "--artifact-dir",
            str(request.artifact_dir),
            "--cdp-url",
            request.cdp_url,
            "--database",
            str(request.database),
            "--queue",
            str(request.queue),
            "--output",
            str(request.output / "indeed-unattended"),
            "--goal-id",
            request.goal.id,
            "--target-submissions",
            str(min(24, request.goal.available)),
            "--max-parallel",
            str(request.max_parallel),
            "--max-candidates",
            str(request.candidate_limit),
            "--checkpoint-human",
            "--assisted-apply",
            "--question-ai-provider",
            "off",
        ]


class SiteRuntimeRegistry:
    def __init__(self, adapters: tuple[ApplicationSiteRuntimeAdapter, ...]) -> None:
        self._adapters = {adapter.site_id: adapter for adapter in adapters}

    def require(self, site_id: str) -> ApplicationSiteRuntimeAdapter:
        try:
            return self._adapters[site_id]
        except KeyError:
            raise ValueError(
                f"no application runtime adapter is registered for {site_id!r}"
            ) from None


DEFAULT_SITE_RUNTIME_REGISTRY = SiteRuntimeRegistry((IndeedRuntimeAdapter(),))
