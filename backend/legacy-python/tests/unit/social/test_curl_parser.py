"""Curl-command parsing for the DevTools-paste login path."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from typer.testing import CliRunner

from resume_builder.cli import app
from resume_builder.sources.social.auth import LoginError, parse_curl_command


# A real shape of what Chrome DevTools emits for "Copy as cURL (bash)" on facebook.com.
_FB_CURL = r"""curl 'https://www.facebook.com/' \
  -H 'authority: www.facebook.com' \
  -H 'accept: text/html,application/xhtml+xml' \
  -H 'accept-language: en-US,en;q=0.9' \
  -H 'cookie: datr=ABC; sb=XYZ; c_user=100012345; xs=42%3Aabcdef%3A2%3A1700000000; fr=DEF; locale=en_US' \
  -H 'user-agent: Mozilla/5.0' \
  --compressed
"""


def test_parses_chrome_devtools_facebook_curl():
    out = parse_curl_command(_FB_CURL)
    assert out.url == "https://www.facebook.com/"
    assert out.cookies["c_user"] == "100012345"
    assert out.cookies["xs"].startswith("42")
    assert out.cookies["datr"] == "ABC"
    assert "user-agent" in {k.lower() for k in out.headers}


def test_parses_cookie_via_b_flag():
    curl = "curl -b 'c_user=999; xs=zz' 'https://www.facebook.com/'"
    out = parse_curl_command(curl)
    assert out.cookies == {"c_user": "999", "xs": "zz"}


def test_parses_windows_cmd_caret_continuations():
    curl = (
        "curl ^\n"
        "  'https://www.linkedin.com/feed/' ^\n"
        "  -H 'cookie: li_at=AbCdEf'\n"
    )
    out = parse_curl_command(curl)
    assert out.cookies == {"li_at": "AbCdEf"}
    assert out.url == "https://www.linkedin.com/feed/"


def test_curl_with_no_cookies_returns_empty_dict():
    out = parse_curl_command("curl 'https://example.com'")
    assert out.cookies == {}
    assert out.url == "https://example.com"


def test_unparseable_curl_raises_login_error():
    with pytest.raises(LoginError, match="parse"):
        parse_curl_command("curl 'unterminated string")


def test_login_advanced_paste_curl_saves_session(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """End-to-end: pick vendor -> advanced -> paste-curl path saves the session."""
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))

    # Menu: vendor=facebook, top-choice=3 (advanced), advanced=c (curl)
    prompts = iter(["facebook", "3", "c"])
    paste_lines = iter(_FB_CURL.splitlines() + [""])

    def fake_input(*a, **kw):
        return next(paste_lines)

    runner = CliRunner()
    with (
        patch("typer.prompt", side_effect=lambda *a, **kw: next(prompts)),
        patch("builtins.input", side_effect=fake_input),
    ):
        result = runner.invoke(app, ["login"], catch_exceptions=False)

    assert result.exit_code == 0, result.output
    saved = (tmp_path / "sessions" / "facebook.json").read_text(encoding="utf-8")
    assert "100012345" in saved
    assert "xs" in saved
