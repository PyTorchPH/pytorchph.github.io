from pathlib import Path

import pytest

from resume_builder.job_application import (
    ApplicationGoalStore,
    DEFAULT_SITE_RUNTIME_REGISTRY,
    SiteCycleRequest,
)


def test_indeed_runtime_adapter_builds_a_goal_scoped_cycle(tmp_path):
    store = ApplicationGoalStore(tmp_path / "history.sqlite3")
    goal = store.create(target=10)
    store.observe(
        goal.id,
        task_id="reserved-job",
        site="indeed",
        company="Reserved Co",
        job_title="Reserved Engineer",
    )
    store.reserve(goal.id, "reserved-job")
    goal = store.get(goal.id)
    request = SiteCycleRequest(
        root=Path("/repo"),
        goal=goal,
        manifest_path=tmp_path / "manifest.json",
        inventory_report_path=tmp_path / "inventory.json",
        attempted_task_ids_path=tmp_path / "seen.json",
        artifact_dir=tmp_path / "resumes",
        database=tmp_path / "history.sqlite3",
        queue=tmp_path / "queue.json",
        output=tmp_path / "out",
        cdp_url="http://127.0.0.1:9222",
        candidate_limit=24,
        max_parallel=3,
    )

    adapter = DEFAULT_SITE_RUNTIME_REGISTRY.require("indeed")
    collect = adapter.collect_command(request)
    run = adapter.run_command(request)

    assert "--employment-type" in collect
    assert "--current-search-only" in collect
    assert collect[collect.index("--inventory-output") + 1] == str(tmp_path / "inventory.json")
    assert collect[collect.index("--employment-type") + 1] == "contract"
    assert collect.count("--target-country") == 1
    assert collect[collect.index("--target-country") + 1] == "Philippines"
    assert "--goal-id" in run
    assert run[run.index("--goal-id") + 1] == goal.id
    assert run[run.index("--target-submissions") + 1] == "9"
    assert "--checkpoint-human" in run
    assert "--assisted-apply" in run
    assert "--safe-draft-only" not in run
    assert run[run.index("--question-ai-provider") + 1] == "off"
    assert "--autonomous-submit" not in run


def test_runtime_registry_rejects_unregistered_site():
    with pytest.raises(ValueError, match="no application runtime adapter"):
        DEFAULT_SITE_RUNTIME_REGISTRY.require("unsupported")
