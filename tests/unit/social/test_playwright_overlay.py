"""playwright_overlay: non-destructive overlay rectangles + a live debug HUD.

No real browser — MagicMock pages/handles, matching test_playwright_debug style. We
assert on the JS that would run and on the opt-in gating (disabled = zero evaluates).
"""

from __future__ import annotations

from unittest.mock import MagicMock

from resume_builder.sources.social.playwright_overlay import (
    clear_overlays,
    ensure_overlay,
    hud_update,
    overlay_box,
    overlay_selector,
)


def test_overlay_is_noop_when_visual_disabled(monkeypatch):
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", raising=False)
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_DELAY_MS", raising=False)
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_HIGHLIGHT_MS", raising=False)
    page = MagicMock()
    element = MagicMock()

    assert ensure_overlay(page) is False
    assert overlay_box(element, color="#fff", label="x") is False
    assert overlay_selector(page, "div", color="#fff") == 0
    assert hud_update(page, [("Card", "1/3")]) is False
    assert clear_overlays(page) == 0

    # Nothing should have touched the page when visual mode is off.
    assert not page.evaluate.called
    assert not element.evaluate.called


def test_ensure_overlay_injects_root_and_hud_when_enabled(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    page = MagicMock()

    assert ensure_overlay(page) is True

    page.evaluate.assert_called_once()
    js = str(page.evaluate.call_args.args[0])
    assert "__rbBox" in js  # box-drawer installed
    assert "__rbHud" in js  # HUD renderer installed
    assert "getBoundingClientRect" in js  # positioned from the element's box


def test_overlay_box_draws_over_the_element_handle(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    element = MagicMock()
    element.evaluate.return_value = True

    assert overlay_box(element, color="#22c55e", label="TEXT", scroll=True) is True

    element.evaluate.assert_called_once()
    js, payload = element.evaluate.call_args.args
    assert "__rbBox" in str(js)
    assert payload == {"color": "#22c55e", "label": "TEXT", "scroll": True}


def test_overlay_selector_bootstraps_then_draws(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    page = MagicMock()
    page.evaluate.side_effect = [True, 4]  # bootstrap, then 4 matches drawn

    count = overlay_selector(page, "div[role='article']", color="#ff2d75", label="posts", ms=500)

    assert count == 4
    # First call bootstraps, second draws the selector boxes.
    assert page.evaluate.call_count == 2
    draw_js = str(page.evaluate.call_args_list[1].args[0])
    assert "querySelectorAll" in draw_js
    assert "scrollIntoView" in draw_js  # follows the newest match downward


def test_hud_update_passes_ordered_rows(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    page = MagicMock()
    page.evaluate.side_effect = [True, True]  # bootstrap, then hud render

    assert hud_update(page, [("Card", "2/3"), ("Status", "Reading text")]) is True

    rows = page.evaluate.call_args_list[1].args[1]
    assert rows == [["Card", "2/3"], ["Status", "Reading text"]]


def test_clear_overlays_returns_removed_count(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    page = MagicMock()
    page.evaluate.return_value = 7

    assert clear_overlays(page) == 7
    page.evaluate.assert_called_once()


def test_overlay_box_survives_detached_handle(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    element = MagicMock()
    element.evaluate.side_effect = RuntimeError("element is detached")

    # A dead handle must not raise — visualization is best-effort.
    assert overlay_box(element, color="#fff") is False
