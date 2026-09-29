from __future__ import annotations

from datetime import datetime, timezone
import time

from resume_builder.job_application import (
    AIAuthAssessment,
    DynamicApplicationPlan,
    JobSessionLogStore,
    JobSessionState,
    SessionFirstApplicationPipeline,
    SessionFirstAuthChecker,
)
from resume_builder.job_application.session_check import SessionLogEntry
from resume_builder.sources.social.auth import SessionStore


class _AuthLLM:
    def __init__(self, state=JobSessionState.SIGNED_IN):
        self.calls = 0
        self.prompt = ""
        self.state = state

    def structured(self, prompt, schema, system=None, max_tokens=2048):
        self.calls += 1
        self.prompt = prompt
        assert schema is AIAuthAssessment
        return AIAuthAssessment(state=self.state, confidence=0.8, evidence=["account shell"])


class _NeverLLM:
    def structured(self, *args, **kwargs):
        raise AssertionError("AI must not run for deterministic session decisions")


class _Planner:
    def __init__(self):
        self.calls = 0

    def plan(self, pages, objective="fill application draft"):
        self.calls += 1
        return DynamicApplicationPlan(root_domain="example.com")


def _checker(tmp_path, llm=None):
    return SessionFirstAuthChecker(
        session_store=SessionStore(tmp_path),
        log_store=JobSessionLogStore(tmp_path),
        llm=llm,
    )


def test_visible_account_marker_is_deterministic_and_skips_ai(tmp_path):
    decision = _checker(tmp_path, _NeverLLM()).check(
        site_key="jobs.example.com",
        url="https://jobs.example.com/applications",
        html='<nav aria-label="Account profile"><a>My applications</a><button>Sign out</button></nav>',
    )
    assert decision.state == JobSessionState.SIGNED_IN
    assert decision.method == "deterministic_dom"
    assert decision.should_continue is True


def test_recent_session_log_plus_usable_storage_state_skips_ai(tmp_path):
    site = "apply.example.com"
    sessions = SessionStore(tmp_path)
    sessions.save_storage_state(
        site,
        {
            "cookies": [
                {
                    "name": "session",
                    "value": "secret-cookie-value",
                    "domain": ".example.com",
                    "expires": time.time() + 3600,
                }
            ]
        },
    )
    logs = JobSessionLogStore(tmp_path)
    logs.append(
        SessionLogEntry(
            site_key=site,
            state=JobSessionState.SIGNED_IN,
            should_continue=True,
            method="deterministic_dom",
            confidence=0.99,
            evidence=["account menu"],
            human_handoff=False,
            checked_at=datetime.now(timezone.utc).isoformat(),
            url="https://apply.example.com/home",
        )
    )
    decision = SessionFirstAuthChecker(
        session_store=sessions,
        log_store=logs,
        llm=_NeverLLM(),
    ).check(
        site_key=site,
        url="https://apply.example.com/form",
        html="<main>Application form shell</main>",
    )
    assert decision.method == "deterministic_session_log"
    assert decision.state == JobSessionState.SIGNED_IN


def test_ambiguous_page_uses_ai_without_cookie_values(tmp_path):
    site = "apply.example.com"
    sessions = SessionStore(tmp_path)
    sessions.save(site, {"session": "do-not-send-this-secret"})
    llm = _AuthLLM()
    decision = SessionFirstAuthChecker(
        session_store=sessions,
        log_store=JobSessionLogStore(tmp_path),
        llm=llm,
    ).check(site_key=site, url="https://apply.example.com/form", html="<main>Application</main>")
    assert decision.method == "ai_fallback"
    assert llm.calls == 1
    assert "usable_cookie_count" in llm.prompt
    assert "do-not-send-this-secret" not in llm.prompt


def test_login_or_signup_wall_stops_before_ai_and_planner(tmp_path):
    checker = _checker(tmp_path, _NeverLLM())
    planner = _Planner()
    result = SessionFirstApplicationPipeline(checker, planner).run(
        site_key="apply.example.com",
        pages=[
            (
                "https://apply.example.com/form",
                '<form><input type="password"><button>Create an account</button></form>',
            )
        ],
    )
    assert result.session.state == JobSessionState.SIGNED_OUT
    assert result.plan is None
    assert planner.calls == 0


def test_generic_sign_in_link_is_deterministically_signed_out(tmp_path):
    decision = _checker(tmp_path, _NeverLLM()).check(
        site_key="jobs.example.com",
        url="https://jobs.example.com/search",
        html='<main>Public jobs</main><a href="/login">Sign in</a>',
    )
    assert decision.state == JobSessionState.SIGNED_OUT
    assert decision.method == "deterministic_dom"


def test_signed_in_gate_allows_dynamic_planner(tmp_path):
    checker = _checker(tmp_path, _NeverLLM())
    planner = _Planner()
    result = SessionFirstApplicationPipeline(checker, planner).run(
        site_key="apply.example.com",
        pages=[
            (
                "https://apply.example.com/form",
                "<main><a>My applications</a><button>Sign out</button></main>",
            )
        ],
    )
    assert result.session.should_continue is True
    assert result.plan is not None
    assert planner.calls == 1


def test_verification_page_never_calls_ai(tmp_path):
    decision = _checker(tmp_path, _NeverLLM()).check(
        site_key="apply.example.com",
        url="https://apply.example.com/form",
        html="<h1>Additional Verification Required</h1><p>Cloudflare Ray ID</p>",
    )
    assert decision.state == JobSessionState.VERIFICATION_REQUIRED
    assert decision.human_handoff is True
