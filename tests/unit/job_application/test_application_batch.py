import pytest

from resume_builder.job_application import (
    AccessGateResult,
    AccessGateState,
    ApplicationBatchCoordinator,
    BatchApplicationOutcome,
    BatchApplicationStatus,
    BatchApplicationTask,
    HumanVerificationQueue,
    IndeedSmartApplyModule,
    IndeedSmartApplyRunResult,
    IndeedSmartApplyRunStatus,
    indeed_batch_outcome,
    reconcile_indeed_post_apply,
)
from resume_builder.job_finder import ForeignCountryPolicy


def _task(index: int) -> BatchApplicationTask:
    return BatchApplicationTask(
        task_id=f"task-{index}",
        company=f"Company {index}",
        job_title=f"Engineer {index}",
        domain="apply.example.com",
        target_country="Australia",
        work_mode="remote",
        application_reference=f"Company {index} — Engineer {index}",
    )


def test_parallel_workers_collect_captchas_in_one_thread_safe_queue(tmp_path):
    queue = HumanVerificationQueue(tmp_path / "verification.json")
    tasks = [_task(index) for index in range(6)]

    def worker(task):
        queue.enqueue(
            application_reference=task.application_reference,
            url=f"https://{task.domain}/review",
            result=AccessGateResult(
                state=AccessGateState.HUMAN_REQUIRED,
                reason="captcha",
            ),
        )
        return BatchApplicationOutcome(
            task=task,
            status=BatchApplicationStatus.VERIFICATION_PENDING,
        )

    result = ApplicationBatchCoordinator(max_parallel=3).run(tasks, worker)

    assert [outcome.task.task_id for outcome in result.outcomes] == [task.task_id for task in tasks]
    assert len(result.verification_pending) == 6
    assert len(queue.pending()) == 6


def test_worker_exception_fails_only_its_task_closed():
    tasks = [_task(1), _task(2)]

    def worker(task):
        if task.task_id == "task-1":
            raise RuntimeError("browser drift")
        return BatchApplicationOutcome(
            task=task,
            status=BatchApplicationStatus.SUBMITTED,
        )

    result = ApplicationBatchCoordinator(max_parallel=2).run(tasks, worker)

    assert result.outcomes[0].status == BatchApplicationStatus.FAILED
    assert result.outcomes[1].status == BatchApplicationStatus.SUBMITTED


def test_worker_cannot_substitute_country_or_work_mode():
    task = _task(1)

    def worker(original):
        changed = original.model_copy(
            update={"target_country": "Philippines", "work_mode": "onsite"}
        )
        return BatchApplicationOutcome(
            task=changed,
            status=BatchApplicationStatus.SUBMITTED,
        )

    result = ApplicationBatchCoordinator(max_parallel=1).run([task], worker)

    assert result.outcomes[0].status == BatchApplicationStatus.FAILED
    assert "location preference" in result.outcomes[0].detail


def test_batch_rejects_country_outside_human_selected_foreign_list():
    policy = ForeignCountryPolicy(
        home_country="Philippines",
        home_country_aliases=("PH", "PHL"),
        selected_countries=("Australia", "Canada"),
    )

    with pytest.raises(ValueError, match="not explicitly selected"):
        ApplicationBatchCoordinator(country_policy=policy).run(
            [_task(1).model_copy(update={"target_country": "United States"})],
            lambda task: BatchApplicationOutcome(
                task=task,
                status=BatchApplicationStatus.SUBMITTED,
            ),
        )


def test_indeed_captcha_handoff_maps_to_verification_batch():
    outcome = indeed_batch_outcome(
        _task(1),
        IndeedSmartApplyRunResult(
            status=IndeedSmartApplyRunStatus.HUMAN_HANDOFF,
            module=IndeedSmartApplyModule.REVIEW,
            stop_reason="final submit gate: access gate: captcha",
        ),
    )

    assert outcome.status == BatchApplicationStatus.VERIFICATION_PENDING


class _Body:
    def __init__(self, text):
        self.text = text

    @property
    def first(self):
        return self

    def count(self):
        return 1

    def inner_text(self):
        return self.text


class _PostApplyPage:
    url = "https://smartapply.indeed.com/beta/indeedapply/form/post-apply"

    def __init__(self, text="Your application has been submitted!"):
        self.body = _Body(text)

    def locator(self, selector):
        if selector == "body":
            return self.body
        return _Empty()


class _Empty:
    @property
    def first(self):
        return self

    def count(self):
        return 0

    def nth(self, _index):
        return self


def test_post_apply_confirmation_resolves_queue_and_records_sql(tmp_path):
    task = _task(1).model_copy(
        update={
            "company": "Example Co",
            "job_title": "Backend Intern",
            "application_reference": "Example Co — Backend Intern",
        }
    )
    queue = HumanVerificationQueue(tmp_path / "verification.json")
    queue.enqueue(
        application_reference=task.application_reference,
        url="https://smartapply.indeed.com/beta/indeedapply/form/review-module",
        result=AccessGateResult(
            state=AccessGateState.HUMAN_REQUIRED,
            reason="captcha",
        ),
    )
    from resume_builder.job_application import ApplicationSubmissionHistory

    history = ApplicationSubmissionHistory(tmp_path / "submissions.sqlite3")
    outcome = reconcile_indeed_post_apply(
        _PostApplyPage(),
        task,
        verification_queue=queue,
        submission_history=history,
    )

    assert outcome is not None
    assert outcome.status == BatchApplicationStatus.SUBMITTED
    assert queue.pending() == []
    assert history.recent_submissions()[0].job_title == "Backend Intern"


def test_post_apply_route_without_confirmation_fails_closed(tmp_path):
    from resume_builder.job_application import ApplicationSubmissionHistory

    outcome = reconcile_indeed_post_apply(
        _PostApplyPage("Thanks for visiting"),
        _task(1),
        verification_queue=HumanVerificationQueue(tmp_path / "verification.json"),
        submission_history=ApplicationSubmissionHistory(tmp_path / "submissions.sqlite3"),
    )

    assert outcome is not None
    assert outcome.status == BatchApplicationStatus.FAILED
