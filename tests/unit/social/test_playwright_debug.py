from __future__ import annotations

from unittest.mock import MagicMock

from resume_builder.sources.social.playwright_debug import (
    highlight_selector,
    launch_options,
    visual_debug_from_env,
)


def test_launch_options_use_chrome_channel_without_visual_env(monkeypatch):
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", raising=False)
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_DELAY_MS", raising=False)
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_HIGHLIGHT_MS", raising=False)
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_HEADLESS", raising=False)
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_CHANNEL", raising=False)

    debug = visual_debug_from_env()

    assert debug.enabled is False
    assert launch_options(True, debug) == {"headless": True, "channel": "chrome"}


def test_channel_override_falls_back_to_bundled_chromium(monkeypatch):
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", raising=False)
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_HEADLESS", raising=False)
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_CHANNEL", "chromium")

    debug = visual_debug_from_env()

    assert launch_options(True, debug) == {"headless": True}


def test_visual_debug_forces_headed_browser_and_slow_mo(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_DELAY_MS", raising=False)
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_HIGHLIGHT_MS", raising=False)
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_HEADLESS", "1")
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_CHANNEL", raising=False)

    debug = visual_debug_from_env()

    assert debug.enabled is True
    assert launch_options(True, debug) == {
        "headless": False,
        "channel": "chrome",
        "args": ["--start-maximized"],
        "slow_mo": 700,
    }


def test_highlight_selector_outlines_and_pauses_when_visual_debug_enabled(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    page = MagicMock()

    highlight_selector(page, "input#email", label="email")

    # Delegates to the overlay layer: bootstrap + draw (>=1 evaluate), then one pause.
    assert page.evaluate.called
    page.wait_for_timeout.assert_called_once()
    # Non-destructive: the draw JS uses the overlay box-drawer, not node.style mutation.
    drawn_js = " ".join(str(c.args[0]) for c in page.evaluate.call_args_list)
    assert "__rbBox" in drawn_js
