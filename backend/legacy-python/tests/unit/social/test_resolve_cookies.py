"""Layered cookie resolution: env > session store > browser, browser is Chrome-first."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from resume_builder.sources.social.auth import (
    SessionStore,
    resolve_session_cookies,
)
from resume_builder.sources.social.browser_cookies import ImportReport


@pytest.fixture(autouse=True)
def _isolate_session_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Each test gets a clean session-store and clean env."""
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))
    for v in ("FB_COOKIE", "LI_COOKIE", "IG_COOKIE", "TW_COOKIE"):
        monkeypatch.delenv(v, raising=False)


def test_env_var_wins_over_everything(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    SessionStore(base_dir=tmp_path).save("facebook", {"c_user": "STORED"})
    monkeypatch.setenv("FB_COOKIE", "c_user=ENV; xs=Y")
    cookies = resolve_session_cookies("facebook")
    assert cookies == {"c_user": "ENV", "xs": "Y"}


def test_env_single_key_value_maps_to_named_cookie(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("LI_COOKIE", "raw_li_at_value")  # no '=' → treat as li_at
    cookies = resolve_session_cookies("linkedin")
    assert cookies == {"li_at": "raw_li_at_value"}


def test_session_store_used_when_env_empty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))
    # Resolver's SessionStore is constructed inside the call — it reads from
    # the env-pointed dir, so saving via a parallel store with the same path works.
    from resume_builder.sources.social.auth import _default_session_dir

    SessionStore(base_dir=_default_session_dir()).save("twitter", {"auth_token": "AT1"})
    monkeypatch.setenv("RESUME_BUILDER_NO_BROWSER_COOKIES", "1")
    cookies = resolve_session_cookies("twitter")
    assert cookies == {"auth_token": "AT1"}


def test_browser_fallback_used_when_env_and_store_empty(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RESUME_BUILDER_NO_BROWSER_COOKIES", raising=False)
    fake = ImportReport(
        cookies={"sessionid": "FROM_BROWSER"}, attempts=[("chrome", "loaded 1 cookies")]
    )
    with patch(
        "resume_builder.sources.social.browser_cookies.import_cookies_report",
        return_value=fake,
    ):
        cookies = resolve_session_cookies("instagram")
    assert cookies == {"sessionid": "FROM_BROWSER"}


def test_browser_fallback_disabled_via_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RESUME_BUILDER_NO_BROWSER_COOKIES", "1")
    with patch("resume_builder.sources.social.browser_cookies.import_cookies_report") as m:
        cookies = resolve_session_cookies("instagram")
    assert cookies == {}
    m.assert_not_called()


def test_chrome_is_first_in_default_browser_chain():
    """Browser-agnostic but Chrome-preferred: chrome must appear first."""
    from resume_builder.sources.social.browser_cookies import _DOMAINS  # noqa: F401
    import resume_builder.sources.social.browser_cookies as bcmod

    calls: list[str] = []

    class _FakeBC:
        def chrome(self, domain_name):
            calls.append("chrome")
            return []

        def edge(self, domain_name):
            calls.append("edge")
            return []

        def firefox(self, domain_name):
            calls.append("firefox")
            return []

        def brave(self, domain_name):
            calls.append("brave")
            return []

        def opera(self, domain_name):
            calls.append("opera")
            return []

    fake = _FakeBC()
    with patch.dict("sys.modules", {"browser_cookie3": fake}):
        bcmod.import_cookies_report("twitter", browser="auto")
    assert calls[:1] == ["chrome"], f"chrome must be tried first; got {calls}"
