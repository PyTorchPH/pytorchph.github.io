from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from resume_builder.web import app as web_app
from resume_builder.web.app import app
from resume_builder.web.auth import IdentityStore
from resume_builder.web.cdo_advisor import (
    AdvisorAIOutput,
    AdvisorChoice,
    AdvisorQuestion,
    AdvisorTag,
)


def test_sidebar_is_user_facing_spa_without_dev_or_auth_pages():
    response = TestClient(app).get("/prototype")

    assert response.status_code == 200
    html = response.text
    assert "page-panel" in html
    assert 'data-page-target="dashboard"' in html
    assert 'data-page-target="evidence"' in html
    assert 'data-page-target="resume"' in html
    assert 'data-page-target="advisor"' in html
    assert "Dev / Testing" not in html
    assert "Auth Hub" not in html
    assert "Knowledge Graph" not in html
    assert 'data-page-target="phase-plan"' not in html
    assert 'data-page-target="auth"' not in html


def test_prototype_visualizes_full_scraping_flow():
    response = TestClient(app).get("/prototype")

    assert response.status_code == 200
    html = response.text
    assert "Visual Scraping" not in html
    assert "Full scrape is shown step by step" not in html
    assert 'data-page-target="visual-scraping"' not in html
    assert "Sidebar is now SPA navigation" not in html


@pytest.mark.parametrize(
    "path",
    [
        "/developer/scraping",
        "/developer/event-pipeline",
        "/developer/job-scraping",
        "/developer/job-scraping/dom",
        "/developer/resume-builder",
    ],
)
def test_developer_workbenches_are_not_shipped_by_product_app(path):
    assert TestClient(app).get(path).status_code == 404


def test_latest_job_scraping_api_returns_visualization_artifact(tmp_path, monkeypatch):
    monkeypatch.setattr(web_app, "_ARTIFACT_ROOT", tmp_path)

    response = TestClient(app).get("/api/job-scraping/latest")

    assert response.status_code == 404
    assert response.json() == {"error": "No real job-scraping artifact is available."}


def test_dashboard_renders_get_started_auth_controls():
    response = TestClient(app).get("/prototype")

    assert response.status_code == 200
    html = response.text
    assert "Let's Get Started" in html
    assert "Identity providers" in html
    assert 'data-social-login="facebook"' in html
    assert 'data-social-login="linkedin"' in html
    assert "/static/prototype.js" in html


def test_resume_studio_has_preview_controls_and_generated_resume_mount():
    response = TestClient(app).get("/prototype")

    assert response.status_code == 200
    html = response.text
    assert "Format preview controls" in html
    assert "Injection JSON slots" in html
    assert "Not executed yet" in html
    assert "Generated resumes" in html
    assert "data-resume-list" in html


def test_api_resumes_lists_generated_formats(tmp_path, monkeypatch):
    resume_dir = tmp_path / "resumes" / "fullstack-web"
    resume_dir.mkdir(parents=True)
    (resume_dir / "resume.html").write_text("<h1>Resume</h1>", encoding="utf-8")
    (resume_dir / "resume.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(web_app, "_ARTIFACT_ROOT", tmp_path)

    response = TestClient(app).get("/api/resumes")

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["role_id"] == "fullstack-web"
    assert payload["items"][0]["formats"]["html"] == (
        "/artifacts/resumes/fullstack-web/resume.html"
    )
    assert payload["items"][0]["formats"]["json"] == (
        "/artifacts/resumes/fullstack-web/resume.json"
    )


def test_cdo_advisor_endpoint_returns_ai_injection_with_deterministic_scores(monkeypatch):
    class _FakeLLM:
        def structured(self, prompt, schema, system=None, max_tokens=2048):
            assert schema is AdvisorAIOutput
            assert "Do not compute readiness scores" in system
            assert "Campus event platform" in prompt
            return AdvisorAIOutput(
                tags=[
                    AdvisorTag(
                        evidence_id="ach-1",
                        competency="React and FastAPI delivery",
                        category="technical",
                        confidence=0.9,
                        rationale="Repository describes the stack and workflow.",
                    ),
                    AdvisorTag(
                        evidence_id="ach-2",
                        competency="Team delivery",
                        category="project_delivery",
                        confidence=0.8,
                        rationale="Hackathon finalist evidence shows delivery.",
                    ),
                ],
                questions=[
                    AdvisorQuestion(
                        question_id="q1",
                        competency="React and FastAPI delivery",
                        prompt="Which backend framework was used?",
                        choices=[
                            AdvisorChoice(id="a", text="FastAPI"),
                            AdvisorChoice(id="b", text="Django"),
                        ],
                        correct_choice_id="a",
                        difficulty="medium",
                    )
                ],
            )

    monkeypatch.setattr(web_app, "get_configured_provider", lambda: _FakeLLM())
    response = TestClient(app).post(
        "/api/cdo/advisor/analyze",
        json={
            "student_id": "demo-student",
            "target_role": "Full-Stack Development Internship",
            "achievements": [
                {
                    "id": "ach-1",
                    "title": "Campus event platform",
                    "source": "GitHub repository",
                    "text": "Built a React and FastAPI campus event platform.",
                },
                {
                    "id": "ach-2",
                    "title": "Hackathon finalist",
                    "source": "LinkedIn post",
                    "text": "Reached hackathon finals with a team prototype.",
                },
            ],
            "mcq_answers": {"q1": "a"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["version"] == "cdo-advisor-v1"
    assert payload["injection"]["tags"][0]["competency"] == "React and FastAPI delivery"
    assert payload["injection"]["questions"][0]["question_id"] == "q1"
    scores = payload["injection"]["scores"]
    assert scores["mcq_score"] == 100
    assert scores["method"] == "65% achievement + 35% mcq"
    assert scores["readiness_score"] == 95


def test_auth_status_defaults_disconnected(tmp_path, monkeypatch):
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))
    monkeypatch.setenv("GITHUB_CLIENT_ID", "")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "")

    response = TestClient(app).get("/api/auth/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["identity"]["github"]["connected"] is False
    assert payload["social"]["facebook"]["connected"] is False
    assert payload["oauth_setup"]["github"]["configured"] is False
    assert payload["oauth_setup"]["github"]["missing"] == [
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
    ]
    assert payload["oauth_setup"]["google"]["redirect_uri"] == (
        "http://127.0.0.1:8010/auth/google/callback"
    )


def test_auth_start_reports_missing_setup(tmp_path, monkeypatch):
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))
    monkeypatch.setenv("GITHUB_CLIENT_ID", "")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "")

    response = TestClient(app).get("/auth/github/start")

    assert response.status_code == 400
    assert response.json()["setup_required"] is True


def test_auth_start_redirects_when_configured(tmp_path, monkeypatch):
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))
    monkeypatch.setenv("GITHUB_CLIENT_ID", "client-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("CAREERLENS_BASE_URL", "http://127.0.0.1:8010")

    response = TestClient(app, follow_redirects=False).get("/auth/github/start")

    assert response.status_code == 302
    assert response.headers["location"].startswith("https://github.com/login/oauth/authorize?")
    assert (
        "redirect_uri=http%3A%2F%2F127.0.0.1%3A8010%2Fauth%2Fgithub%2Fcallback"
        in (response.headers["location"])
    )


@pytest.mark.parametrize(
    ("provider", "expected_url"),
    [
        ("github", "https://github.com/login/oauth/authorize?"),
        ("google", "https://accounts.google.com/o/oauth2/v2/auth?"),
        ("microsoft", "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?"),
    ],
)
def test_auth_start_redirects_for_identity_providers(provider, expected_url, tmp_path, monkeypatch):
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))
    monkeypatch.setenv(f"{provider.upper()}_CLIENT_ID", "client-id")
    monkeypatch.setenv(f"{provider.upper()}_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("CAREERLENS_BASE_URL", "http://127.0.0.1:8010")

    response = TestClient(app, follow_redirects=False).get(f"/auth/{provider}/start")

    assert response.status_code == 302
    assert response.headers["location"].startswith(expected_url)
    assert (
        f"redirect_uri=http%3A%2F%2F127.0.0.1%3A8010%2Fauth%2F{provider}%2Fcallback"
        in response.headers["location"]
    )


def test_auth_callback_rejects_bad_state(tmp_path, monkeypatch):
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))
    monkeypatch.setenv("GITHUB_CLIENT_ID", "client-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "client-secret")

    response = TestClient(app).get("/auth/github/callback?code=x&state=bad")

    assert response.status_code == 400
    assert "state" in response.json()["error"].lower()


def test_mocked_oauth_callback_stores_profile(tmp_path, monkeypatch):
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))
    monkeypatch.setenv("GITHUB_CLIENT_ID", "client-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "client-secret")
    state = IdentityStore().create_state("github")

    class _Response:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    monkeypatch.setattr(
        "resume_builder.web.auth.requests.post",
        lambda *a, **k: _Response({"access_token": "token"}),
    )
    monkeypatch.setattr(
        "resume_builder.web.auth.requests.get",
        lambda *a, **k: _Response(
            {"id": 123, "email": "juan@example.com", "name": "Juan Dela Cruz"}
        ),
    )

    response = TestClient(app, follow_redirects=False).get(
        f"/auth/github/callback?code=ok&state={state}"
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/#dashboard"
    status = TestClient(app).get("/api/auth/status").json()
    assert status["identity"]["github"]["connected"] is True
    assert status["identity"]["github"]["profile"]["email"] == "juan@example.com"


def test_github_oauth_callback_reads_primary_email_when_profile_email_is_private(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))
    monkeypatch.setenv("GITHUB_CLIENT_ID", "client-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "client-secret")
    state = IdentityStore().create_state("github")

    class _Response:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    def fake_get(url, *args, **kwargs):
        if url == "https://api.github.com/user/emails":
            return _Response(
                [
                    {
                        "email": "juan-private@example.com",
                        "primary": True,
                        "verified": True,
                    }
                ]
            )
        return _Response({"id": 123, "email": None, "name": "Juan Dela Cruz"})

    monkeypatch.setattr(
        "resume_builder.web.auth.requests.post",
        lambda *a, **k: _Response({"access_token": "token"}),
    )
    monkeypatch.setattr("resume_builder.web.auth.requests.get", fake_get)

    response = TestClient(app, follow_redirects=False).get(
        f"/auth/github/callback?code=ok&state={state}"
    )

    assert response.status_code == 302
    status = TestClient(app).get("/api/auth/status").json()
    assert status["identity"]["github"]["profile"]["email"] == ("juan-private@example.com")


def test_social_login_job_saves_visible_login_result(tmp_path, monkeypatch):
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))
    IdentityStore().save_profile(
        "github",
        {
            "provider": "github",
            "subject_id": "1",
            "email": "prefill@example.com",
            "display_name": "Prefill User",
            "connected_at": 1,
        },
    )
    calls: list[tuple[str, str | None]] = []

    class _Result:
        cookies = {"li_at": "token"}
        storage_state = {"cookies": [{"name": "li_at", "value": "token"}], "origins": []}

    def fake_open_login_window(vendor, prefill_username=None, **kwargs):
        calls.append((vendor, prefill_username))
        return _Result()

    monkeypatch.setattr("resume_builder.web.app.open_login_window", fake_open_login_window)

    client = TestClient(app)
    response = client.post("/api/social-login/linkedin")

    assert response.status_code == 200
    job_id = response.json()["job_id"]
    for _ in range(20):
        job = client.get(f"/api/social-login/jobs/{job_id}").json()
        if job["status"] == "success":
            break
    assert job["status"] == "success"
    assert calls == [("linkedin", "prefill@example.com")]
    status = client.get("/api/auth/status").json()
    assert status["social"]["linkedin"]["connected"] is True
