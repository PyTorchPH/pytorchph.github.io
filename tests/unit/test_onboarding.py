from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from resume_builder.job_application import ApplicationProfileStore
from resume_builder.web import app as web_app
from resume_builder.web.app import app
from resume_builder.web.onboarding import OnboardingService


def _artifacts(root: Path) -> Path:
    root.mkdir()
    (root / "mega-combined-resume.json").write_text(
        json.dumps(
            {
                "profile": {"name": "Ada Lovelace", "github": "https://github.com/ada"},
                "target_roles": [{"slug": "software-systems"}],
            }
        ),
        encoding="utf-8",
    )
    (root / "software-systems.resume.json").write_text(
        json.dumps(
            {
                "role": {
                    "id": "software-systems",
                    "label": "Software Systems Engineer",
                    "must_have_skills": ["Python", "FastAPI"],
                    "keywords": ["backend"],
                },
                "summary": "Builds reliable systems.",
                "skill_groups": [{"name": "Python", "items": ["FastAPI"]}],
                "projects": [{"name": "Compiler"}],
            }
        ),
        encoding="utf-8",
    )
    (root / "software-systems.pdf").write_bytes(b"%PDF-1.4 seeded")
    return root


def _hashes(root: Path) -> dict[str, str]:
    return {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in root.iterdir()
        if path.is_file()
    }


def test_seeded_flow_asks_one_blocker_then_becomes_ready_without_rewriting_json(tmp_path):
    artifacts = _artifacts(tmp_path / "outputs")
    before = _hashes(artifacts)
    service = OnboardingService(
        artifact_dir=artifacts,
        database=tmp_path / "application.sqlite3",
    )

    assert service.state()["current_blocker"]["field"] == "name"
    assert service.save_correction(
        "name", {"first_name": "Ada", "last_name": "Lovelace"}
    )["current_blocker"]["field"] == "country"
    assert service.save_correction(
        "country",
        {
            "country_name": "Philippines",
            "country_iso": "PH",
            "phone_calling_code": "+63",
        },
    )["current_blocker"]["field"] == "phone"
    assert service.save_correction(
        "phone", {"verified_phone": "+63 912 345 6789"}
    )["phase"] == "job_preferences"
    ready = service.save_preferences(
        target=3,
        target_countries=["Australia"],
        work_mode="remote",
        employment_type="contract",
        safe_auto_start=True,
    )

    assert ready["ready"] is True
    assert ready["next_url"] == "/dashboard"
    assert ready["source"]["resumes"][0]["routing_ready"] is True
    assert _hashes(artifacts) == before


def test_verified_runtime_identity_skips_contact_corrections(tmp_path):
    artifacts = _artifacts(tmp_path / "outputs")
    database = tmp_path / "application.sqlite3"
    ApplicationProfileStore(database).save_verified_identity(
        first_name="Ada",
        last_name="Lovelace",
        country_name="Philippines",
        country_iso="PH",
        phone_calling_code="+63",
        verified_phone="+639123456789",
    )

    state = OnboardingService(artifact_dir=artifacts, database=database).state()

    assert state["phase"] == "job_preferences"
    assert state["profile"] == {
        "name": "Ada Lovelace",
        "country": "Philippines",
        "phone_configured": True,
    }


def test_empty_outsourcing_selection_resolves_to_philippines(tmp_path):
    artifacts = _artifacts(tmp_path / "outputs")
    database = tmp_path / "application.sqlite3"
    ApplicationProfileStore(database).save_verified_identity(
        first_name="Ada",
        last_name="Lovelace",
        country_name="Philippines",
        country_iso="PH",
        phone_calling_code="+63",
        verified_phone="+639123456789",
    )
    service = OnboardingService(artifact_dir=artifacts, database=database)

    state = service.save_preferences(
        target=3,
        target_countries=[],
        work_mode="remote",
        employment_type="contract",
        safe_auto_start=True,
    )

    assert state["preferences"]["target_countries"] == ["Philippines"]


def test_invalid_seed_blocks_dashboard_as_system_error(tmp_path):
    artifacts = tmp_path / "outputs"
    artifacts.mkdir()
    (artifacts / "mega-combined-resume.json").write_text("not json", encoding="utf-8")

    state = OnboardingService(
        artifact_dir=artifacts,
        database=tmp_path / "application.sqlite3",
    ).state()

    assert state["phase"] == "error"
    assert state["ready"] is False
    assert state["source"]["errors"]


def test_main_entry_redirects_from_onboarding_state(monkeypatch):
    monkeypatch.setattr(
        web_app,
        "_onboarding_service",
        lambda: SimpleNamespace(state=lambda: {"next_url": "/dashboard"}),
    )

    response = TestClient(app).get("/", follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == "/dashboard"


def test_setup_and_dashboard_are_distinct_layered_pages(monkeypatch):
    monkeypatch.setattr(
        web_app,
        "_onboarding_service",
        lambda: SimpleNamespace(
            state=lambda: {"ready": True, "next_url": "/dashboard"}
        ),
    )
    client = TestClient(app)

    setup = client.get("/setup")
    dashboard = client.get("/dashboard")

    assert setup.status_code == 200
    assert "One clear decision at a time" in setup.text
    assert "/static/onboarding.js" in setup.text
    assert dashboard.status_code == 200
    assert "Job Finder Control Center" in dashboard.text


def test_dashboard_redirects_to_setup_until_onboarding_is_ready(monkeypatch):
    monkeypatch.setattr(
        web_app,
        "_onboarding_service",
        lambda: SimpleNamespace(state=lambda: {"ready": False}),
    )

    response = TestClient(app).get("/dashboard", follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == "/setup"


def test_auto_start_is_idempotent_for_one_onboarding_revision(monkeypatch):
    marked: list[tuple[str, str]] = []
    service = SimpleNamespace(
        state=lambda: {
            "ready": True,
            "activation_key": "revision-1",
            "auto_started_goal_id": "",
            "preferences": {
                "target": 3,
                "target_countries": ["Australia"],
                "work_mode": "remote",
                "employment_type": "contract",
                "safe_auto_start": True,
            },
        },
        mark_auto_started=lambda key, goal_id: marked.append((key, goal_id)),
    )
    monkeypatch.setattr(web_app, "_onboarding_service", lambda: service)
    monkeypatch.setattr(
        web_app,
        "job_finder_control_state",
        lambda: {"sessions": {"job_sites": {"indeed": {"connected": True}}}},
    )
    monkeypatch.setattr(
        web_app,
        "job_finder_goal_store",
        lambda: SimpleNamespace(active=lambda: None),
    )
    monkeypatch.setattr(
        web_app,
        "create_job_finder_goal",
        lambda **kwargs: SimpleNamespace(id="goal-1"),
    )

    response = TestClient(app).post("/api/job-finder/auto-start")

    assert response.status_code == 200
    assert response.json() == {
        "started": True,
        "goal_id": "goal-1",
        "mode": "safe_draft_only",
    }
    assert marked == [("revision-1", "goal-1")]
