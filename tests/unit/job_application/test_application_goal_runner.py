import json
from pathlib import Path
from types import SimpleNamespace

from resume_builder.job_application import ApplicationGoalStatus, ApplicationGoalStore
from tools.job_finder import run_application_goal


def test_retry_jobs_replays_observed_microtask_from_prior_manifest(tmp_path):
    manifest = tmp_path / "cycle-0001" / "manifest.json"
    manifest.parent.mkdir()
    manifest.write_text(
        json.dumps(
            {
                "jobs": [
                    {"task_id": "retry-me", "company": "Acme"},
                    {"task_id": "terminal", "company": "Done"},
                ]
            }
        ),
        encoding="utf-8",
    )
    items = [
        SimpleNamespace(task_id="retry-me", state=SimpleNamespace(value="observed")),
        SimpleNamespace(task_id="terminal", state=SimpleNamespace(value="skipped")),
    ]

    assert run_application_goal._retry_jobs(tmp_path, items) == [
        {"task_id": "retry-me", "company": "Acme"}
    ]


def test_retry_jobs_recovers_job_from_unattended_run_artifact(tmp_path):
    goal_root = tmp_path / "goals" / "goal-1"
    run_path = tmp_path / "indeed-unattended" / "run-1" / "run.json"
    run_path.parent.mkdir(parents=True)
    job = {"task_id": "retry-me", "company": "Acme"}
    run_path.write_text(json.dumps({"jobs": [job]}), encoding="utf-8")
    items = [SimpleNamespace(task_id="retry-me", state=SimpleNamespace(value="observed"))]

    assert run_application_goal._retry_jobs(
        goal_root, items, output_root=tmp_path
    ) == [job]


def test_next_cycle_number_does_not_overwrite_previous_runs(tmp_path):
    (tmp_path / "cycle-0002").mkdir()
    (tmp_path / "cycle-invalid").mkdir()

    assert run_application_goal._next_cycle_number(tmp_path) == 3


def test_exhausted_inventory_stops_after_one_scan(tmp_path, monkeypatch):
    database = tmp_path / "history.sqlite3"
    store = ApplicationGoalStore(database)
    goal = store.create(target=20)
    calls = []

    def fake_run(command, *, log_path):
        calls.append(command)
        manifest = Path(command[command.index("--output") + 1])
        inventory = Path(command[command.index("--inventory-output") + 1])
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text('{"jobs": []}', encoding="utf-8")
        inventory.write_text(
            '{"schema_version": 1, "status": "exhausted", "observed": 10}',
            encoding="utf-8",
        )
        return 0

    monkeypatch.setattr(run_application_goal, "_run_command", fake_run)
    result = run_application_goal.supervise(
        SimpleNamespace(
            database=database,
            goal_id=goal.id,
            output=tmp_path / "out",
            artifact_dir=tmp_path / "resumes",
            queue=tmp_path / "queue.json",
            cdp_url="http://127.0.0.1:9222",
            max_parallel=3,
        )
    )

    assert result == 2
    assert len(calls) == 1
    assert "--current-search-only" in calls[0]
    assert store.get(goal.id).status == ApplicationGoalStatus.WAITING_FOR_CANDIDATES
