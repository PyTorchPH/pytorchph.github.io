"""Unit tests for the layout bounds helpers.

The geometry helpers are pure and browser-free. The Playwright-backed
``analyze_html_bounds`` is exercised by an integration test that skips when no
Chromium is installed.
"""

from __future__ import annotations

import pytest

from resume_builder.layout import (
    A4_HEIGHT_MM,
    page_content_height_px,
    straddles_boundary,
)
from resume_builder.layout.bounds import page_content_width_px


def test_page_content_height_a4_default_margin():
    # A4 height 297mm minus 2*14mm margins -> 269mm at 96px/25.4mm.
    expected = (A4_HEIGHT_MM - 2 * 14.0) * 96.0 / 25.4
    assert page_content_height_px() == pytest.approx(expected)


def test_page_content_width_a4_default_margin():
    expected = (210.0 - 2 * 14.0) * 96.0 / 25.4
    assert page_content_width_px() == pytest.approx(expected)


def test_block_within_single_page_does_not_straddle():
    page = 1000.0
    assert straddles_boundary(top=10.0, bottom=900.0, page_height=page) is False


def test_block_crossing_page_line_straddles():
    page = 1000.0
    # Starts on page 0, ends on page 1.
    assert straddles_boundary(top=900.0, bottom=1100.0, page_height=page) is True


def test_block_resting_on_boundary_is_not_flagged():
    page = 1000.0
    # Bottom lands exactly on the line; epsilon tolerance keeps it whole.
    assert straddles_boundary(top=10.0, bottom=1000.0, page_height=page) is False


def test_degenerate_inputs_do_not_straddle():
    assert straddles_boundary(top=5.0, bottom=5.0, page_height=1000.0) is False
    assert straddles_boundary(top=0.0, bottom=100.0, page_height=0.0) is False


def _chromium_available() -> bool:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return False
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            browser.close()
        return True
    except Exception:
        return False


@pytest.mark.integration
@pytest.mark.skipif(not _chromium_available(), reason="Chromium not installed for Playwright")
def test_analyze_html_bounds_single_page_fits():
    from resume_builder.layout import analyze_html_bounds

    html = """
    <main class="sheet">
      <header><h1 class="role-title">Engineer</h1></header>
      <section><h2>Summary</h2>
        <div class="entry"><span class="lead">Short</span></div>
      </section>
    </main>
    """
    report = analyze_html_bounds(html)
    assert report.page_count == 1
    assert report.fits_one_page is True
    assert report.oversized_blocks == []
    assert any(b.label == "Short" for b in report.blocks)
