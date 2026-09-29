"""Manual cookie paste collector + login CLI option 3."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from typer.testing import CliRunner

from resume_builder.cli import _VENDOR_COOKIES, _collect_manual_cookies, app


@pytest.fixture(autouse=True)
def _isolate_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))


def test_facebook_required_cookies():
    assert _VENDOR_COOKIES["facebook"] == ("c_user", "xs")


def test_collect_manual_cookies_strips_quotes_and_whitespace():
    pastes = iter(['  "100012345"  ', "  'abcXYZxs=='  "])

    def fake_input(prompt: str, **kwargs) -> str:
        return next(pastes)

    with patch("resume_builder.cli.masked_input", side_effect=fake_input):
        result = _collect_manual_cookies("facebook")

    assert result == {"c_user": "100012345", "xs": "abcXYZxs=="}


def test_collect_manual_cookies_skips_blank_values():
    pastes = iter(["c_user_value", "   "])

    def fake_input(prompt: str, **kwargs) -> str:
        return next(pastes)

    with patch("resume_builder.cli.masked_input", side_effect=fake_input):
        result = _collect_manual_cookies("facebook")

    assert result == {"c_user": "c_user_value"}
    assert "xs" not in result


def test_collect_manual_cookies_unknown_vendor_returns_empty():
    assert _collect_manual_cookies("ghost") == {}


def test_login_advanced_paste_cookies_saves_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """End-to-end: pick vendor -> advanced -> paste cookies path saves the session."""
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))

    # Menu flow: vendor=facebook, top-choice=3 (advanced), advanced=b (paste cookies)
    inputs = iter(["facebook", "3", "b"])
    pastes = iter(["100012345", "xs-token-here"])

    runner = CliRunner()
    with (
        patch("typer.prompt", side_effect=lambda *a, **kw: next(inputs)),
        patch("resume_builder.cli.masked_input", side_effect=lambda p, **k: next(pastes)),
    ):
        result = runner.invoke(app, ["login"], catch_exceptions=False)

    assert result.exit_code == 0, result.output
    saved = (tmp_path / "sessions" / "facebook.json").read_text(encoding="utf-8")
    assert "100012345" in saved
    assert "xs-token-here" in saved
