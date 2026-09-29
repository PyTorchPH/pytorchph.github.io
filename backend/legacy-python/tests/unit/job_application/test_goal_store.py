from concurrent.futures import ThreadPoolExecutor

import pytest

from resume_builder.job_application import (
    ApplicationGoalStatus,
    ApplicationGoalStore,
    GoalItemState,
    SalaryBand,
)


def _item(store: ApplicationGoalStore, goal_id: str, index: int) -> str:
    task_id = f"job-{index}"
    store.observe(
        goal_id,
        task_id=task_id,
        site="indeed",
        company=f"Company {index}",
        job_title=f"Engineer {index}",
    )
    return task_id


def test_goal_reservations_are_durable_and_releaseable(tmp_path):
    store = ApplicationGoalStore(tmp_path / "history.sqlite3")
    goal = store.create(target=2)
    first = _item(store, goal.id, 1)
    second = _item(store, goal.id, 2)
    third = _item(store, goal.id, 3)

    assert store.reserve(goal.id, first) is True
    assert store.reserve(goal.id, first) is True
    assert store.reserve(goal.id, second) is True
    assert store.reserve(goal.id, third) is False
    assert store.get(goal.id).reserved == 2

    released = store.release(goal.id, first)

    assert released.reserved == 1
    assert released.available == 1
    assert store.reserve(goal.id, third) is True


def test_confirm_is_idempotent_and_reaches_exact_target(tmp_path):
    store = ApplicationGoalStore(tmp_path / "history.sqlite3")
    goal = store.create(target=1)
    task_id = _item(store, goal.id, 1)
    store.reserve(goal.id, task_id)

    reached = store.confirm(goal.id, task_id, detail="manual confirmation")
    repeated = store.confirm(goal.id, task_id, detail="manual confirmation")

    assert reached.confirmed == repeated.confirmed == 1
    assert repeated.reserved == 0
    assert repeated.status == ApplicationGoalStatus.TARGET_REACHED
    assert store.item(goal.id, task_id).state == GoalItemState.CONFIRMED


def test_concurrent_confirmations_never_exceed_target(tmp_path):
    database = tmp_path / "history.sqlite3"
    store = ApplicationGoalStore(database)
    goal = store.create(target=10)
    task_ids = [_item(store, goal.id, index) for index in range(20)]

    def confirm(task_id: str) -> bool:
        try:
            ApplicationGoalStore(database).confirm(goal.id, task_id)
            return True
        except ValueError:
            return False

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(confirm, task_ids))

    final = store.get(goal.id)
    assert sum(results) == 10
    assert final.confirmed == 10
    assert final.remaining == 0
    assert final.status == ApplicationGoalStatus.TARGET_REACHED


def test_new_goal_cancels_previous_active_goal(tmp_path):
    store = ApplicationGoalStore(tmp_path / "history.sqlite3")
    first = store.create(target=3)
    second = store.create(target=4)

    assert store.get(first.id).status == ApplicationGoalStatus.CANCELLED
    assert store.active().id == second.id


def test_target_must_be_positive(tmp_path):
    store = ApplicationGoalStore(tmp_path / "history.sqlite3")

    with pytest.raises(ValueError, match="at least 1"):
        store.create(target=0)


def test_salary_band_reservations_enforce_quota_and_unknown_is_review_only(tmp_path):
    store = ApplicationGoalStore(tmp_path / "history.sqlite3")
    goal = store.create(target=20)
    tasks = []
    for index in range(11):
        task_id = f"salary-{index}"
        store.observe(
            goal.id,
            task_id=task_id,
            site="indeed",
            company="Example",
            job_title=f"Junior Python Developer {index}",
            salary_band=SalaryBand.PHP_20K_40K,
            job_level="junior",
        )
        tasks.append(task_id)
    for task_id in tasks[:10]:
        assert store.reserve(goal.id, task_id) is True
    assert store.reserve(goal.id, tasks[10]) is False

    store.observe(
        goal.id,
        task_id="unknown-salary",
        site="indeed",
        company="Unknown",
        job_title="Software Engineering Intern",
        salary_band=SalaryBand.UNKNOWN,
        job_level="intern",
    )
    assert store.reserve(goal.id, "unknown-salary") is False
    confirmed = store.confirm(goal.id, "unknown-salary", detail="manual review")
    assert confirmed.confirmed == 0
    assert store.item(goal.id, "unknown-salary").counts_toward_target is False


def test_retry_observation_does_not_erase_verified_salary_or_level(tmp_path):
    store = ApplicationGoalStore(tmp_path / "history.sqlite3")
    goal = store.create(target=20)
    store.observe(
        goal.id,
        task_id="verified",
        site="indeed",
        company="Example",
        job_title="Junior Developer",
        salary_signal="PHP 30,000 monthly",
        salary_monthly_min_php=30_000,
        salary_monthly_max_php=30_000,
        salary_band=SalaryBand.PHP_20K_40K,
        job_level="junior",
    )

    store.observe(
        goal.id,
        task_id="verified",
        site="indeed",
        company="Example",
        job_title="Junior Developer",
        detail="replay queued",
    )

    item = store.item(goal.id, "verified")
    assert item.salary_band == SalaryBand.PHP_20K_40K
    assert item.salary_monthly_min_php == 30_000
    assert item.job_level.value == "junior"


def test_control_center_review_approval_is_limited_to_non_access_evidence_gaps(tmp_path):
    store = ApplicationGoalStore(tmp_path / "history.sqlite3")
    goal = store.create(target=20)
    store.observe(
        goal.id,
        task_id="salary-review",
        site="indeed",
        company="Example",
        job_title="Data Analyst Intern",
        state=GoalItemState.HUMAN_HANDOFF,
        detail="salary review required: salary unavailable",
        salary_band=SalaryBand.UNKNOWN,
        job_level="intern",
    )

    approved = store.approve_human_review(goal.id, "salary-review")

    assert approved.state == GoalItemState.OBSERVED
    assert approved.human_review_approved is True
    assert approved.counts_toward_target is False

    store.observe(
        goal.id,
        task_id="captcha",
        site="indeed",
        company="Blocked",
        job_title="Junior Developer",
        state=GoalItemState.HUMAN_HANDOFF,
        detail="access gate remains pending: verification_required",
    )
    with pytest.raises(ValueError, match="cannot be approved"):
        store.approve_human_review(goal.id, "captcha")
