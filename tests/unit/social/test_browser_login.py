"""Playwright login flow tested with a fully mocked playwright module."""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest

from resume_builder.sources.social.browser_login import (
    PlaywrightNotInstalled,
    open_login_window,
)


def _make_playwright(
    cookie_jar_sequence: list[list[dict]],
    storage_state: dict | None = None,
    *,
    query_selector_returns: object = MagicMock(),
    page_url: str = "https://www.facebook.com/",
):
    """Build a fake sync_playwright that returns the supplied cookie jars in order.

    ``page_url`` is what ``page.url`` reports (must be a real string so the
    substring URL check works).
    """
    context = MagicMock()
    storage = storage_state if storage_state is not None else {"cookies": [], "origins": []}
    context.cookies.side_effect = list(cookie_jar_sequence)
    context.storage_state.return_value = storage
    browser = MagicMock()
    browser.new_context.return_value = context
    page = MagicMock()
    page.query_selector.return_value = query_selector_returns
    page.url = page_url
    context.new_page.return_value = page
    chromium = MagicMock()
    chromium.launch.return_value = browser
    pw = MagicMock()
    pw.chromium = chromium

    @contextmanager
    def fake_sync_playwright():
        yield pw

    return fake_sync_playwright, browser, page, context


def test_returns_cookies_when_success_cookie_appears():
    jars = [
        [],  # first poll — not signed in yet
        [{"name": "c_user", "value": "100012345"}, {"name": "xs", "value": "abc"}],
        # settle-window poll — same state
        [{"name": "c_user", "value": "100012345"}, {"name": "xs", "value": "abc"}],
    ]
    fake_pw, browser, page, _ = _make_playwright(jars, storage_state={"cookies": [{"name": "c_user"}]})
    result = open_login_window(
        "facebook",
        poll_seconds=0.0,
        timeout_seconds=5.0,
        settle_seconds=0.0,
        playwright_module=fake_pw,
    )
    assert result.cookies["c_user"] == "100012345"
    assert result.cookies["xs"] == "abc"
    assert result.storage_state == {"cookies": [{"name": "c_user"}]}
    page.goto.assert_called_once_with("https://www.facebook.com/")
    browser.close.assert_called_once()


def test_uses_existing_chrome_cdp_when_configured(monkeypatch):
    jars = [
        [{"name": "c_user", "value": "100012345"}],
        [{"name": "c_user", "value": "100012345"}],
    ]
    context = MagicMock()
    context.cookies.side_effect = jars
    context.storage_state.return_value = {"cookies": [{"name": "c_user"}], "origins": []}
    page = MagicMock()
    page.query_selector.return_value = MagicMock()
    page.url = "https://www.facebook.com/"
    context.new_page.return_value = page
    browser = MagicMock()
    browser.contexts = [context]
    chromium = MagicMock()
    chromium.connect_over_cdp.return_value = browser
    pw = MagicMock()
    pw.chromium = chromium

    @contextmanager
    def fake_sync_playwright():
        yield pw

    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_CDP_URL", "http://127.0.0.1:9222")
    result = open_login_window(
        "facebook",
        poll_seconds=0.0,
        timeout_seconds=5.0,
        settle_seconds=0.0,
        playwright_module=fake_sync_playwright,
    )

    assert result.cookies["c_user"] == "100012345"
    chromium.connect_over_cdp.assert_called_once_with("http://127.0.0.1:9222")
    chromium.launch.assert_not_called()
    context.new_page.assert_called_once()
    page.close.assert_called_once()
    browser.close.assert_not_called()


def test_times_out_when_success_cookie_never_arrives():
    # `cookies()` keeps returning an empty jar forever.
    context = MagicMock()
    context.cookies.return_value = []
    context.storage_state.return_value = {"cookies": [], "origins": []}
    browser = MagicMock()
    browser.new_context.return_value = context
    context.new_page.return_value = MagicMock()
    chromium = MagicMock()
    chromium.launch.return_value = browser
    pw = MagicMock()
    pw.chromium = chromium

    @contextmanager
    def fake_sync_playwright():
        yield pw

    with pytest.raises(TimeoutError, match="c_user"):
        open_login_window(
            "facebook",
            poll_seconds=0.0,
            timeout_seconds=0.05,
            settle_seconds=0.0,
            playwright_module=fake_sync_playwright,
        )


def test_missing_playwright_raises_clear_install_message(monkeypatch):
    """When playwright isn't installed, surface a PlaywrightNotInstalled with install hint."""
    # Block the import so the lazy path falls through to the ImportError branch.
    import sys

    monkeypatch.setitem(sys.modules, "playwright.sync_api", None)
    with pytest.raises(PlaywrightNotInstalled, match="pip install playwright"):
        open_login_window("facebook")


def test_different_vendor_uses_right_success_cookie():
    jars = [[{"name": "li_at", "value": "AbCdEf"}], [{"name": "li_at", "value": "AbCdEf"}]]
    fake_pw, _, page, _ = _make_playwright(jars, page_url="https://www.linkedin.com/feed/")
    result = open_login_window(
        "linkedin",
        poll_seconds=0.0,
        timeout_seconds=5.0,
        settle_seconds=0.0,
        playwright_module=fake_pw,
    )
    assert result.cookies == {"li_at": "AbCdEf"}
    page.goto.assert_called_once_with("https://www.linkedin.com/login")


def test_prefill_username_types_into_facebook_email_field():
    """Pre-fill should target FB's input#email selector from the DevTools analysis."""
    jars = [
        [{"name": "c_user", "value": "100012345"}],
        [{"name": "c_user", "value": "100012345"}],
    ]
    fake_pw, _, page, _ = _make_playwright(jars)
    open_login_window(
        "facebook",
        prefill_username="jane.doe@example.com",
        poll_seconds=0.0,
        timeout_seconds=5.0,
        settle_seconds=0.0,
        playwright_module=fake_pw,
    )
    page.wait_for_selector.assert_called_once_with("input#email", timeout=10_000)
    page.fill.assert_called_once_with("input#email", "jane.doe@example.com")


def test_login_success_uses_session_cookie_without_feed_probe():
    """Auth capture should stop once the vendor session cookie exists."""
    context = MagicMock()
    context.cookies.return_value = [{"name": "c_user", "value": "100"}]
    context.storage_state.return_value = {"cookies": [], "origins": []}
    browser = MagicMock()
    browser.new_context.return_value = context
    page = MagicMock()
    page.url = "https://www.bing.com/search?q=facebook"
    context.new_page.return_value = page
    chromium = MagicMock()
    chromium.launch.return_value = browser
    pw = MagicMock()
    pw.chromium = chromium

    @contextmanager
    def fake_sync_playwright():
        yield pw

    result = open_login_window(
        "facebook",
        poll_seconds=0.0,
        timeout_seconds=0.05,
        settle_seconds=0.0,
        playwright_module=fake_sync_playwright,
    )

    assert result.cookies == {"c_user": "100"}
    page.query_selector.assert_not_called()


def test_does_not_probe_success_selector_before_cookie_exists():
    """Login landmarks like div[role='main'] must not be treated as signed-in UI."""
    context = MagicMock()
    context.cookies.return_value = []
    context.storage_state.return_value = {"cookies": [], "origins": []}
    browser = MagicMock()
    browser.new_context.return_value = context
    page = MagicMock()
    page.url = "https://www.facebook.com/"
    context.new_page.return_value = page
    chromium = MagicMock()
    chromium.launch.return_value = browser
    pw = MagicMock()
    pw.chromium = chromium

    @contextmanager
    def fake_sync_playwright():
        yield pw

    with pytest.raises(TimeoutError):
        open_login_window(
            "facebook",
            poll_seconds=0.0,
            timeout_seconds=0.05,
            settle_seconds=0.0,
            playwright_module=fake_sync_playwright,
        )

    page.query_selector.assert_not_called()


def test_twofa_callback_fires_when_2fa_input_appears(monkeypatch):
    """When FB's approvals_code field becomes visible, the CLI gets a one-shot hint."""
    cookie_jars = [[], [], [{"name": "c_user", "value": "x"}], [{"name": "c_user", "value": "x"}]]

    # The 2FA selector is queried before the success check; first calls return truthy
    # (2FA visible), later we don't care because cookie path exits the loop.
    fake_pw, _, page, _ = _make_playwright(cookie_jars)
    notifications: list[str] = []

    open_login_window(
        "facebook",
        poll_seconds=0.0,
        timeout_seconds=5.0,
        settle_seconds=0.0,
        playwright_module=fake_pw,
        on_twofa_detected=notifications.append,
    )
    assert notifications == ["facebook"], (
        "2FA callback should fire exactly once when approvals_code becomes visible"
    )
