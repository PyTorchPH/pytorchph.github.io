import pytest

from resume_builder.job_application import ApplicationGoalStore, GoalItemState
from resume_builder.web import job_finder_supervisor


def test_empty_country_selection_starts_a_philippines_goal(monkeypatch, tmp_path):
    store = ApplicationGoalStore(tmp_path / "history.sqlite3")
    launched = []
    monkeypatch.setattr(job_finder_supervisor, "goal_store", lambda: store)
    monkeypatch.setattr(job_finder_supervisor, "launch_goal", launched.append)

    goal = job_finder_supervisor.start_goal(
        target=3,
        target_countries=[],
        work_mode="remote",
        employment_type="contract",
    )

    assert goal.target_countries == ["Philippines"]
    assert launched == [goal.id]


def test_stop_refuses_process_group_not_owned_by_goal(monkeypatch):
    monkeypatch.setattr(
        job_finder_supervisor,
        "process_status",
        lambda _goal_id: {"running": True, "pid": 123, "exit_code": None},
    )
    monkeypatch.setattr(job_finder_supervisor.os, "getpgid", lambda _pid: 999)
    killed = []
    monkeypatch.setattr(job_finder_supervisor.os, "killpg", lambda *args: killed.append(args))

    with pytest.raises(RuntimeError, match="not owned"):
        job_finder_supervisor.stop_goal("goal-1")

    assert killed == []


def test_resolved_intervention_returns_exact_goal_item_to_replay(monkeypatch, tmp_path):
    store = ApplicationGoalStore(tmp_path / "history.sqlite3")
    goal = store.create(target=1)
    store.observe(
        goal.id,
        task_id="job-1",
        site="indeed",
        company="Acme",
        job_title="Engineer",
        state=GoalItemState.HUMAN_HANDOFF,
    )
    monkeypatch.setattr(job_finder_supervisor, "goal_store", lambda: store)

    task_id = job_finder_supervisor.retry_resolved_intervention("Acme — Engineer")

    assert task_id == "job-1"
    assert store.item(goal.id, task_id).state == GoalItemState.OBSERVED


def test_resolved_intervention_prefers_access_gate_and_suppresses_duplicate(
    monkeypatch, tmp_path
):
    store = ApplicationGoalStore(tmp_path / "history.sqlite3")
    goal = store.create(target=1)
    store.observe(
        goal.id,
        task_id="verification-task",
        site="indeed",
        company="Acme",
        job_title="Engineer",
        state=GoalItemState.HUMAN_HANDOFF,
        detail="access gate remains pending: verification_required",
    )
    store.observe(
        goal.id,
        task_id="stale-artifact",
        site="indeed",
        company="Acme",
        job_title="Engineer",
        state=GoalItemState.HUMAN_HANDOFF,
        detail="rendered listing does not prove the exact manifest company/title",
    )
    monkeypatch.setattr(job_finder_supervisor, "goal_store", lambda: store)

    task_id = job_finder_supervisor.retry_resolved_intervention("Acme — Engineer")

    assert task_id == "verification-task"
    assert store.item(goal.id, "verification-task").state == GoalItemState.OBSERVED
    assert store.item(goal.id, "stale-artifact").state == GoalItemState.SKIPPED
