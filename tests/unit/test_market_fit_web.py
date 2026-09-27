from __future__ import annotations

import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from resume_builder.core.models import Resume, ResumeProject, ResumeSkillGroup, RoleSpec
from resume_builder.job_application.market_fit.models import (
    InterviewPrepDraft,
    InterviewStory,
    JobDemandDraft,
    JobRequirement,
    RequirementKind,
)
from resume_builder.web import app as web_app
from resume_builder.web.app import app
from resume_builder.web import market_fit_control


def test_job_finder_page_contains_market_fit_interview_workspace(monkeypatch):
    monkeypatch.setattr(
        web_app,
        "_onboarding_service",
        lambda: SimpleNamespace(state=lambda: {"ready": True}),
    )
    response = TestClient(app).get("/job-finder-control")

    assert response.status_code == 200
    assert "Market Fit &amp; Interviews" in response.text
    assert "Research-grounded validation loop" in response.text
    assert "Approve edited demands" in response.text or "data-market-detail" in response.text


def test_market_fit_api_creates_updates_and_records_outcomes(tmp_path, monkeypatch):
    database = tmp_path / "market.sqlite3"
    artifact_dir = tmp_path / "resumes"
    artifact_dir.mkdir()
    monkeypatch.setattr(market_fit_control, "DEFAULT_DATABASE", database)
    monkeypatch.setattr(market_fit_control, "DEFAULT_ARTIFACT_DIR", artifact_dir)
    client = TestClient(app)

    created = client.post(
        "/api/job-finder/market-fit/opportunities",
        json={
            "company": "Example AI",
            "job_title": "Python Engineer",
            "description": "Python and FastAPI are required.",
            "track": "contract_project",
            "application_mode": "manual_tailored",
        },
    )

    assert created.status_code == 200
    opportunity_id = created.json()["id"]
    updated = client.put(
        f"/api/job-finder/market-fit/opportunities/{opportunity_id}",
        json={"resume_file": "python.pdf"},
    )
    event = client.post(
        f"/api/job-finder/market-fit/opportunities/{opportunity_id}/events",
        json={"stage": "applied", "note": "Manual confirmation"},
    )
    state = client.get("/api/job-finder/market-fit")

    assert updated.status_code == 200
    assert updated.json()["resume_file"] == "python.pdf"
    assert event.status_code == 200
    assert state.status_code == 200
    assert state.json()["analytics"]["total_opportunities"] == 1


def test_market_fit_campaign_rejects_invalid_mix(tmp_path, monkeypatch):
    monkeypatch.setattr(market_fit_control, "DEFAULT_DATABASE", tmp_path / "market.sqlite3")
    client = TestClient(app)
    campaign = client.get("/api/job-finder/market-fit").json()["campaign"]
    campaign["track_mix"] = {"full_time": 50, "contract_project": 50, "freelance": 50}

    response = client.put("/api/job-finder/market-fit/campaign", json=campaign)

    assert response.status_code == 422


def test_verified_demand_fit_and_interview_prep_api_flow(tmp_path, monkeypatch):
    database = tmp_path / "market.sqlite3"
    artifact_dir = tmp_path / "resumes"
    artifact_dir.mkdir()
    resume = Resume(
        role=RoleSpec(id="python", label="Python Engineer"),
        skill_groups=[ResumeSkillGroup(name="Python", items=["FastAPI"])],
        projects=[
            ResumeProject(
                name="Automation workflow",
                description="Built a Python and FastAPI automation workflow.",
            )
        ],
    )
    (artifact_dir / "python.resume.json").write_text(
        json.dumps(resume.model_dump(mode="json"), default=str),
        encoding="utf-8",
    )

    class FakeLLM:
        def structured(self, prompt, schema, system=None, max_tokens=2048):
            if schema is JobDemandDraft:
                return JobDemandDraft(
                    requirements=[
                        JobRequirement(
                            id="req-1",
                            kind=RequirementKind.SKILL,
                            text="Python FastAPI",
                            source_quote="Python and FastAPI required",
                            confidence=0.95,
                        )
                    ],
                    confidence=0.95,
                )
            assert schema is InterviewPrepDraft
            return InterviewPrepDraft(
                competency_themes=["Python FastAPI"],
                likely_question_themes=["Automation design"],
                stories=[
                    InterviewStory(
                        competency="Python FastAPI",
                        question_theme="Describe an automation project",
                        action="Built a Python and FastAPI automation workflow.",
                        evidence_ids=["skill_group:0"],
                    )
                ],
            )

    monkeypatch.setattr(market_fit_control, "DEFAULT_DATABASE", database)
    monkeypatch.setattr(market_fit_control, "DEFAULT_ARTIFACT_DIR", artifact_dir)
    monkeypatch.setattr(web_app, "get_configured_provider", lambda: FakeLLM())
    client = TestClient(app)
    opportunity = client.post(
        "/api/job-finder/market-fit/opportunities",
        json={
            "company": "Example AI",
            "job_title": "Python Engineer",
            "description": "Python and FastAPI required",
            "resume_file": "python.pdf",
        },
    ).json()
    base = f"/api/job-finder/market-fit/opportunities/{opportunity['id']}"

    draft = client.post(f"{base}/demands/draft")
    approved = client.put(
        f"{base}/demands",
        json={
            key: value
            for key, value in draft.json().items()
            if key in {"requirements", "constraints", "warnings", "confidence"}
        },
    )
    assessment = client.post(f"{base}/assessment")
    prep = client.post(f"{base}/interview-prep")
    prep_approval = client.put(f"{base}/interview-prep/approve", json={})

    assert draft.status_code == 200
    assert approved.json()["verified"] is True
    assert assessment.json()["demands_abilities"] == "complete"
    assert prep.json()["stories"][0]["evidence_ids"] == ["skill_group:0"]
    assert prep_approval.json()["approved"] is True
