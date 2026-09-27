from __future__ import annotations

from typer.testing import CliRunner

from resume_builder.cli import _apply_visual_env, app
from resume_builder.llm import LLMProvider, register_provider
from resume_builder.sources.social.playwright_debug import visual_debug_from_env

runner = CliRunner()


_VISUAL_ENV = (
    "RESUME_BUILD_PLAYWRIGHT_VISUAL",
    "RESUME_BUILD_PLAYWRIGHT_DELAY_MS",
    "RESUME_BUILD_PLAYWRIGHT_HIGHLIGHT_MS",
)


def test_apply_visual_env_noop_when_disabled(monkeypatch):
    for key in _VISUAL_ENV:
        monkeypatch.delenv(key, raising=False)

    _apply_visual_env(False, None)

    assert visual_debug_from_env().enabled is False


def test_apply_visual_env_sets_headed_slow_mo_and_highlight(monkeypatch):
    for key in _VISUAL_ENV:
        monkeypatch.delenv(key, raising=False)

    _apply_visual_env(True, 1200)

    debug = visual_debug_from_env()
    assert debug.enabled is True
    assert debug.force_headed is True
    assert debug.delay_ms == 1200
    # Highlight defaults to at least the step delay so the outline survives the pause.
    assert debug.highlight_ms == 1200


def test_scrape_exposes_visual_flags():
    result = runner.invoke(app, ["scrape", "--help"])
    assert result.exit_code == 0
    assert "--visual" in result.output
    assert "--delay-ms" in result.output


class _FakeReviewProvider(LLMProvider):
    name = "fake-review"
    last_prompt: str | None = None
    last_system: str | None = None

    def complete(self, prompt, system=None, max_tokens=1024):
        type(self).last_prompt = prompt
        type(self).last_system = system
        return "# Critical Issues\n- Missing quantified impact"


def test_list_roles_command():
    result = runner.invoke(app, ["list-roles"])
    assert result.exit_code == 0
    assert "cybersecurity-blueteam" in result.stdout


def test_build_missing_role_fails():
    result = runner.invoke(
        app, ["build", "--mode", "static", "--gh-user", "x"]
    )
    assert result.exit_code != 0
    assert "--role" in result.stdout or "--role" in (result.stderr or "")


def test_review_command_uses_findings_only_prompt(tmp_path):
    register_provider("fake-review", lambda _: _FakeReviewProvider())
    resume = tmp_path / "resume.txt"
    resume.write_text("Jane Doe\nBuilt dashboard\n", encoding="utf-8")

    result = runner.invoke(
        app,
        ["review", "--docs", str(resume), "--llm-provider", "fake-review"],
    )

    assert result.exit_code == 0
    assert "Missing quantified impact" in result.stdout
    assert _FakeReviewProvider.last_prompt is not None
    assert "Built dashboard" in _FakeReviewProvider.last_prompt
    assert _FakeReviewProvider.last_system is not None
    assert "Resume Review Orchestrator" in _FakeReviewProvider.last_system
