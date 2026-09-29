from __future__ import annotations

import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from resume_builder.job_application import (
    ApplicationSubmissionHistory,
    ConfirmationSource,
    HumanVerificationQueue,
    InterventionAction,
)
from resume_builder.web.app import app
from resume_builder.web import app as web_app
from resume_builder.web import job_finder_control


def test_job_finder_control_page_is_standalone(monkeypatch):
    monkeypatch.setattr(
        web_app,
        "_onboarding_service",
        lambda: SimpleNamespace(state=lambda: {"ready": True}),
    )
    response = TestClient(app).get("/job-finder-control")

    assert response.status_code == 200
    assert "Job Finder Control Center" in response.text
    assert "Automatic Work" in response.text
    assert "Needs Human Intervention" in response.text
    assert "Salary &amp; Funnel Analytics" in response.text
    assert "data-search-inventory" in response.text
    assert 'data-view-link="overview"' in response.text
    assert "/static/job_finder_control.js" in response.text


def test_control_state_combines_latest_run_and_groupable_interventions(
    tmp_path,
    monkeypatch,
):
    run_root = tmp_path / "runs"
    run_dir = run_root / "latest"
    run_dir.mkdir(parents=True)
    (run_dir / "run.json").write_text(
        json.dumps(
            {
                "status": "running",
                "confirmed_submissions": 1,
                "jobs": [
                    {
                        "task_id": "job-1",
                        "company": "Example Co",
                        "job_title": "Backend Engineer",
                        "domain": "au.indeed.com",
                        "resume_file": "software-systems.pdf",
                    },
                    {
                        "task_id": "job-2",
                        "company": "Second Co",
                        "job_title": "Python Engineer",
                        "domain": "au.indeed.com",
                    },
                ],
                "outcomes": [
                    {
                        "task": {"task_id": "job-1"},
                        "status": "submitted",
                        "detail": "confirmed",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    queue_path = tmp_path / "queue.json"
    HumanVerificationQueue(queue_path).enqueue_handoff(
        application_reference="Second Co — Python Engineer",
        url="https://smartapply.indeed.com/questions-module?token=secret",
        reason="unknown_question",
        browser_target_id="target-2",
        action=InterventionAction.UNKNOWN_QUESTION,
        question_labels=["Are you available to work weekends?"],
    )
    monkeypatch.setattr(job_finder_control, "DEFAULT_RUN_ROOT", run_root)
    monkeypatch.setattr(job_finder_control, "DEFAULT_QUEUE_PATH", queue_path)
    monkeypatch.setattr(
        job_finder_control,
        "_targets",
        lambda: [
            {
                "id": "target-2",
                "type": "page",
                "title": "Python Engineer",
                "url": "https://smartapply.indeed.com/questions-module",
            }
        ],
    )
    monkeypatch.setattr(job_finder_control, "_goal_state", lambda: ({}, []))
    monkeypatch.setattr(job_finder_control, "_resume_catalog", lambda: [])
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path / "auth"))

    state = job_finder_control.control_state()

    assert state["run"]["status"] == "running"
    assert [item["status"] for item in state["automatic"]] == ["submitted", "queued"]
    assert state["automatic"][0]["resume_file"] == "software-systems.pdf"
    assert state["interventions"][0]["action"] == "unknown_question"
    assert state["interventions"][0]["site"] == "indeed"
    assert state["interventions"][0]["question_labels"] == ["Are you available to work weekends?"]
    assert state["counts"]["interventions"] == 1
    assert "secret" not in json.dumps(state)


def test_control_state_counts_only_current_plan_interventions(tmp_path, monkeypatch):
    queue_path = tmp_path / "queue.json"
    queue = HumanVerificationQueue(queue_path)
    queue.enqueue_handoff(
        application_reference="Historical Co — Old Engineer",
        url="https://smartapply.indeed.com/questions-module",
        reason="unknown_question",
        browser_target_id="closed-old-target",
        goal_id="old-goal",
    )
    queue.enqueue_handoff(
        application_reference="Current Co — Junior Engineer",
        url="https://smartapply.indeed.com/questions-module",
        reason="unknown_question",
        browser_target_id="closed-current-target",
        task_id="current-1",
        company="Current Co",
        job_title="Junior Engineer",
        goal_id="current-goal",
    )
    goal = {"id": "current-goal", "status": "waiting_for_human"}
    goal_items = [
        {
            "task_id": "current-1",
            "company": "Current Co",
            "job_title": "Junior Engineer",
            "state": "human_handoff",
        },
        {
            "task_id": "current-2",
            "company": "Second Co",
            "job_title": "Data Intern",
            "state": "human_handoff",
        },
    ]
    monkeypatch.setattr(job_finder_control, "DEFAULT_QUEUE_PATH", queue_path)
    monkeypatch.setattr(job_finder_control, "_latest_run", lambda: {"status": "finished"})
    monkeypatch.setattr(job_finder_control, "_targets", lambda: [])
    monkeypatch.setattr(job_finder_control, "_goal_state", lambda: (goal, goal_items))
    monkeypatch.setattr(job_finder_control, "_resume_lookup", lambda: ({}, {}))
    monkeypatch.setattr(job_finder_control, "_resume_catalog", lambda: [])
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path / "auth"))

    state = job_finder_control.control_state()

    assert [item["application_reference"] for item in state["interventions"]] == [
        "Current Co — Junior Engineer"
    ]
    assert state["counts"]["interventions"] == 2
    assert len(state["work_items"]) == 2
    assert state["work_items"][0]["source"] == "queue"
    assert state["work_items"][1]["source"] == "goal"
    assert state["work_items"][1]["actions"] == ["retry", "release"]


def test_current_queue_accepts_live_legacy_target_but_not_inactive_goal(tmp_path):
    queue = HumanVerificationQueue(tmp_path / "queue.json")
    live = queue.enqueue_handoff(
        application_reference="Live Co — Engineer",
        url="https://smartapply.indeed.com/questions-module",
        reason="unknown_question",
        browser_target_id="live-target",
    )
    historical = queue.enqueue_handoff(
        application_reference="Old Co — Engineer",
        url="https://smartapply.indeed.com/questions-module",
        reason="unknown_question",
        browser_target_id="closed-target",
        goal_id="cancelled-goal",
    )

    current = job_finder_control._current_queue_entries(
        [live, historical],
        live_target_ids={"live-target"},
        goal={"id": "cancelled-goal", "status": "cancelled"},
        goal_items=[],
    )

    assert current == [live]
    assert (
        job_finder_control._current_intervention_count(
            [],
            {"id": "cancelled-goal", "status": "cancelled"},
            [{"task_id": "old", "state": "human_handoff"}],
        )
        == 0
    )


def test_current_queue_recovers_redacted_goal_id_by_task_identity(tmp_path):
    queue = HumanVerificationQueue(tmp_path / "queue.json")
    entry = queue.enqueue_handoff(
        application_reference="Current Co — Junior Engineer",
        url="https://ph.indeed.com/viewjob?jk=abc123",
        reason="verification_required",
        browser_target_id="closed-target",
        task_id="current-1",
        goal_id="other-goal",
    )

    current = job_finder_control._current_queue_entries(
        [entry],
        live_target_ids=set(),
        goal={"id": "current-goal", "status": "waiting_for_human"},
        goal_items=[
            {
                "task_id": "current-1",
                "company": "Current Co",
                "job_title": "Junior Engineer",
                "state": "human_handoff",
            }
        ],
    )

    assert current == [entry]


def test_reopen_intervention_reattaches_stale_access_target(tmp_path, monkeypatch):
    queue_path = tmp_path / "queue.json"
    queue = HumanVerificationQueue(queue_path)
    entry = queue.enqueue_handoff(
        application_reference="Current Co — Junior Engineer",
        url="https://ph.indeed.com/viewjob?jk=abc123",
        reason="verification_required",
        browser_target_id="closed-target",
        task_id="current-1",
    )
    monkeypatch.setattr(job_finder_control, "DEFAULT_QUEUE_PATH", queue_path)
    monkeypatch.setattr(
        job_finder_control,
        "_goal_state",
        lambda: (
            {"id": "current-goal", "status": "waiting_for_human"},
            [{"task_id": "current-1"}],
        ),
    )
    monkeypatch.setattr(
        job_finder_control,
        "open_browser_url",
        lambda url: {"target_id": "new-target", "url": url},
    )
    monkeypatch.setattr(
        job_finder_control,
        "_latest_run",
        lambda: {
            "jobs": [
                {
                    "task_id": "current-1",
                    "listing_url": "https://ph.indeed.com/viewjob?jk=abc123",
                }
            ]
        },
    )

    result = job_finder_control.reopen_intervention(entry.id)

    assert result["target_id"] == "new-target"
    assert result["url"] == "https://ph.indeed.com/viewjob?jk=abc123"
    updated = HumanVerificationQueue(queue_path).get(entry.id)
    assert updated is not None
    assert updated.browser_target_id == "new-target"
    assert updated.goal_id == "current-goal"


def test_question_bank_state_uses_json_when_mongodb_is_offline(tmp_path, monkeypatch):
    fallback = (
        tmp_path
        / "var"
        / "state"
        / "job-applications"
        / "binance-bap-approved-answers.json"
    )
    fallback.parent.mkdir(parents=True)
    fallback.write_text(
        json.dumps({"domain": "smartapply.indeed.com", "pages": [{}, {}]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(job_finder_control, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(job_finder_control, "_QUESTION_BANK_CACHE", None)
    monkeypatch.setitem(__import__("sys").modules, "pymongo", None)

    state = job_finder_control._question_bank_state()

    assert state == {
        "source": "approved JSON",
        "pages": 2,
        "status": "MongoDB offline; JSON fallback ready",
    }


def test_resume_gate_approval_requires_the_exact_live_resume_page(tmp_path, monkeypatch):
    queue_path = tmp_path / "queue.json"
    queue = HumanVerificationQueue(queue_path)
    entry = queue.enqueue_handoff(
        application_reference="Current Co — Junior Engineer",
        url="https://smartapply.indeed.com/resume-module?token=secret",
        reason="resume_upload",
        action=job_finder_control.InterventionAction.RESUME_UPLOAD,
        browser_target_id="resume-target",
    )
    monkeypatch.setattr(job_finder_control, "DEFAULT_QUEUE_PATH", queue_path)
    monkeypatch.setattr(
        job_finder_control,
        "_targets",
        lambda: [
            {
                "id": "resume-target",
                "url": "https://smartapply.indeed.com/resume-module",
            }
        ],
    )

    result = job_finder_control.approve_resume_intervention(entry.id)

    assert result["action"] == "resume_upload"
    assert HumanVerificationQueue(queue_path).get(entry.id).status.value == "resolved"


def test_resume_catalog_inventories_generated_artifacts_and_routes(tmp_path, monkeypatch):
    artifact_dir = tmp_path / "outputs"
    artifact_dir.mkdir()
    (artifact_dir / "automation-data.pdf").write_bytes(b"%PDF")
    (artifact_dir / "automation-data.resume.json").write_text(
        json.dumps({"role": {"id": "automation-data", "label": "Automation Engineer"}}),
        encoding="utf-8",
    )
    database = tmp_path / "profile.sqlite3"
    store = job_finder_control.ApplicationProfileStore(database)
    store.replace_resume_route(
        filename="automation-data.pdf",
        terms=["automation", "data engineer"],
    )
    monkeypatch.setattr(job_finder_control, "DEFAULT_ARTIFACT_DIR", artifact_dir)
    monkeypatch.setattr(job_finder_control, "DEFAULT_DATABASE", database)

    catalog = job_finder_control._resume_catalog()

    assert catalog == [
        {
            "filename": "automation-data.pdf",
            "label": "Automation Engineer",
            "role_id": "automation-data",
            "terms": ["automation", "data engineer"],
            "is_default": False,
            "artifact_ready": True,
            "routing_ready": True,
        }
    ]


def test_focus_target_uses_only_validated_cdp_target(monkeypatch):
    captured = {}

    class _Response:
        def raise_for_status(self):
            return None

    def fake_post(url, timeout):
        captured.update(url=url, timeout=timeout)
        return _Response()

    monkeypatch.setattr(job_finder_control.requests, "post", fake_post)

    job_finder_control.focus_target("ABC_123")

    assert captured["url"].endswith("/json/activate/ABC_123")


def test_open_browser_url_uses_shared_browser_tab(monkeypatch):
    monkeypatch.setattr(
        job_finder_control,
        "open_tab",
        lambda url: {"target_id": "SHARED_TAB", "url": url},
    )

    result = job_finder_control.open_browser_url("https://secure.indeed.com/auth")

    assert result == {
        "target_id": "SHARED_TAB",
        "url": "https://secure.indeed.com/auth",
    }


def test_live_pages_expose_safe_path_and_preview_without_query(monkeypatch):
    monkeypatch.setattr(
        job_finder_control,
        "_targets",
        lambda: [
            {
                "id": "TARGET_1",
                "type": "page",
                "title": "Backend Engineer",
                "url": "https://au.indeed.com/viewjob?jk=secret-token",
            },
            {
                "id": "SEARCH",
                "type": "page",
                "title": "Python jobs",
                "url": "https://au.indeed.com/jobs?q=private-search",
            },
            {
                "id": "OTHER",
                "type": "page",
                "title": "Unrelated",
                "url": "https://example.com/private?token=hidden",
            },
        ],
    )

    pages = job_finder_control._live_pages([])

    assert len(pages) == 2
    assert {page["page_role"] for page in pages} == {"search", "application"}
    application = next(page for page in pages if page["page_role"] == "application")
    assert application["safe_path"] == "/viewjob"
    assert application["preview_url"].endswith("/TARGET_1/preview")
    assert "secret-token" not in json.dumps(pages)


def test_stale_queue_target_is_not_focusable():
    entry = SimpleNamespace(
        model_dump=lambda **_kwargs: {
            "browser_target_id": "CLOSED",
            "action": "captcha",
        },
        browser_target_id="CLOSED",
        domain="au.indeed.com",
        action=job_finder_control.InterventionAction.CAPTCHA,
    )

    payload = job_finder_control._entry_payload(entry, live_target_ids={"LIVE"})

    assert payload["can_focus"] is False
    assert payload["preview_url"] == ""


def test_external_application_can_be_explicitly_confirmed_and_resolved(
    tmp_path,
    monkeypatch,
):
    queue_path = tmp_path / "queue.json"
    database = tmp_path / "applications.sqlite3"
    queued = HumanVerificationQueue(queue_path).enqueue_handoff(
        application_reference="Example Co — Backend Engineer",
        url="https://careers.example.com/apply?token=secret",
        reason="apply_on_company_site",
        browser_target_id="external-target",
        task_id="job-1",
        company="Example Co",
        job_title="Backend Engineer",
        resume_file="software-systems.pdf",
    )
    monkeypatch.setattr(job_finder_control, "DEFAULT_QUEUE_PATH", queue_path)
    monkeypatch.setattr(job_finder_control, "DEFAULT_DATABASE", database)
    monkeypatch.setattr(job_finder_control, "_goal_state", lambda: ({}, []))

    result = job_finder_control.confirm_external_intervention(queued.id)

    assert result == {
        "confirmed": True,
        "entry_id": queued.id,
        "goal_id": "",
        "task_id": "job-1",
    }
    assert HumanVerificationQueue(queue_path).pending() == []
    submissions = ApplicationSubmissionHistory(database).recent_submissions(within_days=30)
    assert len(submissions) == 1
    assert submissions[0].company == "Example Co"
    assert submissions[0].job_title == "Backend Engineer"
    assert submissions[0].confirmation_source == ConfirmationSource.MANUAL
    assert submissions[0].source_url == "https://careers.example.com/apply"

    repeated = job_finder_control.confirm_external_intervention(queued.id)
    assert repeated["confirmed"] is True
    assert len(ApplicationSubmissionHistory(database).recent_submissions(within_days=30)) == 1


def test_external_confirmation_requires_structured_identity(tmp_path, monkeypatch):
    queue_path = tmp_path / "queue.json"
    queued = HumanVerificationQueue(queue_path).enqueue_handoff(
        application_reference="Legacy external application",
        url="https://careers.example.com/apply",
        reason="apply_on_company_site",
    )
    monkeypatch.setattr(job_finder_control, "DEFAULT_QUEUE_PATH", queue_path)

    try:
        job_finder_control.confirm_external_intervention(queued.id)
    except ValueError as error:
        assert "structured company/job-title" in str(error)
    else:
        raise AssertionError("legacy handoff must not infer submission identity")


def test_release_can_dismiss_legacy_queue_item_without_goal(tmp_path, monkeypatch):
    queue_path = tmp_path / "queue.json"
    queued = HumanVerificationQueue(queue_path).enqueue_handoff(
        application_reference="Legacy Co — Engineer",
        url="https://careers.example.com/apply",
        reason="apply_on_company_site",
        task_id="legacy-1",
    )
    monkeypatch.setattr(job_finder_control, "DEFAULT_QUEUE_PATH", queue_path)

    result = job_finder_control.release_intervention(queued.id)

    assert result == {"released": True, "goal_id": "", "task_id": "legacy-1"}
    assert HumanVerificationQueue(queue_path).pending() == []


def test_control_frontend_exposes_external_confirmation_action():
    response = TestClient(app).get("/static/job_finder_control.js")

    assert response.status_code == 200
    assert "Confirm submitted" in response.text
    assert "confirm-submitted" in response.text
    assert '"pushState"' in response.text
    assert "popstate" in response.text
    assert "salary_target_mix" in response.text
    assert "Looks right — continue safely" in response.text
    assert "review-approve" in response.text
    assert "Skip job" in response.text
    assert "Scan current results" in response.text
    assert "Search tabs" in response.text
    assert "Application tabs" in response.text
    assert "Save answers & continue" in response.text
    assert '["captcha", "human_verification", "sign_in"].includes' in response.text
    assert "state.work_items || state.interventions" in response.text
    assert "Application layout review" in response.text
    assert "Retry safely" in response.text


def test_unqueued_human_outcome_remains_visible_as_grouped_fallback():
    interventions = job_finder_control._run_interventions(
        {
            "started_at": "2026-08-02T00:00:00+00:00",
            "jobs": [{"task_id": "job-3", "resume_file": "ai-ml-research.pdf"}],
            "outcomes": [
                {
                    "status": "human_handoff",
                    "detail": "questionnaire requires an accepted evidence-grounded answer plan",
                    "task": {
                        "task_id": "job-3",
                        "company": "Example Co",
                        "job_title": "ML Engineer",
                        "domain": "smartapply.indeed.com",
                        "application_reference": "Example Co — ML Engineer",
                    },
                }
            ],
        },
        [],
    )

    assert interventions[0]["action"] == "unknown_question"
    assert interventions[0]["site"] == "indeed"
    assert interventions[0]["can_focus"] is False
    assert interventions[0]["resume_file"] == "ai-ml-research.pdf"


def test_disconnect_can_clear_local_social_session_without_website_logout(
    monkeypatch,
):
    monkeypatch.setattr(job_finder_control, "clear_social_session", lambda provider: True)
    opened = []
    monkeypatch.setattr(job_finder_control, "open_browser_url", opened.append)

    result = job_finder_control.disconnect_provider("linkedin", website_logout=False)

    assert result == {"provider": "linkedin", "cleared": True, "website_logout": None}
    assert opened == []
