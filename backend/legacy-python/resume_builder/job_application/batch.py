"""Bounded parallel coordination for isolated application work items."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from resume_builder.job_finder.country_policy import CountrySelectionPolicy


class BatchApplicationStatus(str, Enum):
    SUBMITTED = "submitted"
    VERIFICATION_PENDING = "verification_pending"
    SKIPPED = "skipped"
    HUMAN_HANDOFF = "human_handoff"
    FAILED = "failed"


class BatchApplicationTask(BaseModel):
    task_id: str
    company: str
    job_title: str
    domain: str
    target_country: str
    work_mode: Literal["remote", "hybrid", "onsite", "any"]
    application_reference: str = ""

    @field_validator("target_country")
    @classmethod
    def require_target_country(cls, value: str) -> str:
        country = value.strip()
        if not country:
            raise ValueError("target_country must be explicit")
        return country


class BatchApplicationOutcome(BaseModel):
    task: BatchApplicationTask
    status: BatchApplicationStatus
    detail: str = ""


class BatchApplicationRun(BaseModel):
    outcomes: list[BatchApplicationOutcome] = Field(default_factory=list)

    @property
    def submitted(self) -> list[BatchApplicationOutcome]:
        return [
            outcome
            for outcome in self.outcomes
            if outcome.status == BatchApplicationStatus.SUBMITTED
        ]

    @property
    def verification_pending(self) -> list[BatchApplicationOutcome]:
        return [
            outcome
            for outcome in self.outcomes
            if outcome.status == BatchApplicationStatus.VERIFICATION_PENDING
        ]


BatchWorker = Callable[[BatchApplicationTask], BatchApplicationOutcome]


class ApplicationBatchCoordinator:
    """Run a bounded set of isolated workers and collect human gates together.

    Browser workers must own independent pages. A Playwright page must never be shared
    between worker threads.
    """

    def __init__(
        self,
        *,
        max_parallel: int = 3,
        country_policy: CountrySelectionPolicy | None = None,
    ) -> None:
        if max_parallel < 1:
            raise ValueError("max_parallel must be at least 1")
        self.max_parallel = max_parallel
        self.country_policy = country_policy

    def run(
        self,
        tasks: Sequence[BatchApplicationTask],
        worker: BatchWorker,
    ) -> BatchApplicationRun:
        if self.country_policy is not None:
            for task in tasks:
                self.country_policy.require_allowed(
                    target_country=task.target_country,
                    work_mode=task.work_mode,
                )
        indexed_outcomes: dict[int, BatchApplicationOutcome] = {}
        with ThreadPoolExecutor(max_workers=self.max_parallel) as executor:
            futures = {
                executor.submit(worker, task): (index, task) for index, task in enumerate(tasks)
            }
            for future in as_completed(futures):
                index, task = futures[future]
                try:
                    outcome = future.result()
                    if outcome.task != task:
                        outcome = BatchApplicationOutcome(
                            task=task,
                            status=BatchApplicationStatus.FAILED,
                            detail=(
                                "worker changed the task identity or location preference"
                            ),
                        )
                except Exception as exc:
                    outcome = BatchApplicationOutcome(
                        task=task,
                        status=BatchApplicationStatus.FAILED,
                        detail=f"worker failed closed: {type(exc).__name__}",
                    )
                indexed_outcomes[index] = outcome
        return BatchApplicationRun(
            outcomes=[indexed_outcomes[index] for index in range(len(tasks))]
        )
