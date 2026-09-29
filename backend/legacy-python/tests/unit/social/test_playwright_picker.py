"""playwright_picker: interactive hover-inspect + click-to-lock element picker.

No real browser — MagicMock pages, matching the other playwright_* tests. We assert
on the injected JS and on the wait/read flow.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from resume_builder.sources.social.playwright_picker import (
    inject_picker,
    read_pick,
    wait_for_pick,
)


def test_inject_picker_installs_hover_and_click_handlers():
    page = MagicMock()
    page.evaluate.return_value = True

    assert inject_picker(page) is True

    page.evaluate.assert_called_once()
    js, payload = page.evaluate.call_args.args
    js = str(js)
    # Hover-inspect + click-to-lock + spotlight + cancel are all wired.
    assert "mousemove" in js and "click" in js
    assert "elementFromPoint" in js  # hover targets the element under the cursor
    assert "__rbPicked" in js        # the click result is stashed for Python
    assert "box-shadow" in js        # spotlight dims everything else
    assert payload["accent"] and payload["locked"]


def test_read_pick_returns_window_value():
    page = MagicMock()
    page.evaluate.return_value = {"selector": "div > div", "text": "hello"}

    assert read_pick(page) == {"selector": "div > div", "text": "hello"}


def test_wait_for_pick_returns_the_click_result():
    page = MagicMock()
    # 1st evaluate = inject (truthy), 2nd = read returns None, 3rd = read returns a pick.
    page.evaluate.side_effect = [True, None, {"selector": "div", "text": "picked"}]

    result = wait_for_pick(page, timeout_s=5, poll_s=0.01)

    assert result == {"selector": "div", "text": "picked"}


def test_wait_for_pick_honors_escape_cancel():
    page = MagicMock()
    page.evaluate.side_effect = [True, {"cancelled": True}]

    result = wait_for_pick(page, timeout_s=5, poll_s=0.01)

    assert result == {"cancelled": True}
