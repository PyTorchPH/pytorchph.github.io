"""HeadlessBrowser + fetch_rendered_html: loads storage_state, navigates, returns HTML."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from resume_builder.sources.social.auth import SessionStore
from resume_builder.sources.social.headless_browser import (
    HeadlessBrowser,
    NoStoredSessionError,
    fetch_rendered_html,
)


def _build_fake_playwright(rendered_html: str):
    page = MagicMock()
    page.content.return_value = rendered_html
    context = MagicMock()
    context.new_page.return_value = page
    browser = MagicMock()
    browser.new_context.return_value = context
    chromium = MagicMock()
    chromium.launch.return_value = browser
    pw = MagicMock()
    pw.chromium = chromium

    @contextmanager
    def fake_sync_playwright():
        yield pw

    return fake_sync_playwright, browser, context, page


def test_raises_when_no_storage_state(tmp_path: Path):
    store = SessionStore(base_dir=tmp_path)
    fake_pw, *_ = _build_fake_playwright("<html></html>")
    with pytest.raises(NoStoredSessionError, match="resume-build login"):
        with HeadlessBrowser("facebook", playwright_module=fake_pw, store=store):
            pass


def test_yields_page_when_storage_state_present(tmp_path: Path):
    store = SessionStore(base_dir=tmp_path)
    store.save_storage_state("facebook", {"cookies": [{"name": "c_user", "value": "1"}], "origins": []})
    fake_pw, browser, context, page = _build_fake_playwright("<html>ok</html>")
    with HeadlessBrowser("facebook", playwright_module=fake_pw, store=store) as p:
        assert p is page
    browser.close.assert_called_once()
    context.set_default_timeout.assert_called_once_with(30_000)


def test_fetch_rendered_html_navigates_and_returns_content(tmp_path: Path):
    store = SessionStore(base_dir=tmp_path)
    store.save_storage_state("facebook", {"cookies": [{"name": "c_user", "value": "1"}], "origins": []})
    fake_pw, _, _, page = _build_fake_playwright("<html><div role='main'>feed</div></html>")
    out = fetch_rendered_html(
        "facebook",
        "https://www.facebook.com/jane.doe",
        wait_for_selector="div[role='main']",
        playwright_module=fake_pw,
        store=store,
    )
    assert "feed" in out
    page.goto.assert_called_once()
    page.wait_for_selector.assert_called_once_with("div[role='main']", timeout=30_000)


def test_fetch_rendered_html_swallows_internal_errors(tmp_path: Path):
    """Any unexpected Playwright failure returns '' so callers can simply check truthiness."""
    store = SessionStore(base_dir=tmp_path)
    store.save_storage_state("facebook", {"cookies": [], "origins": []})

    class Boom(Exception):
        pass

    @contextmanager
    def exploding_pw():
        raise Boom("simulated playwright failure")
        yield  # pragma: no cover

    out = fetch_rendered_html(
        "facebook",
        "https://www.facebook.com/",
        playwright_module=exploding_pw,
        store=store,
    )
    assert out == ""
