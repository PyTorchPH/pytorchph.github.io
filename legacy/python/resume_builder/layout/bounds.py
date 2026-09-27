"""Bounds-aware measurement for rendered HTML resumes.

A flowing HTML document does not "know" whether its content fits the printed
page. This module renders the HTML with a headless Chromium (via Playwright),
emulating print media at A4, and reports:

* the authoritative printed **page count** (from the actual PDF the browser
  produces);
* every atomic block (an experience/project/achievement/education entry) that is
  **taller than a single page** — an unavoidable mid-bleed; and
* every block that **straddles a page boundary** in natural flow — the ones the
  print stylesheet pushes to the next page (informational: they explain the
  whitespace / where the breaks land).

The geometry helpers (:func:`page_content_height_px`, :func:`straddles_boundary`)
are pure functions and are unit-tested without a browser. :func:`analyze_html_bounds`
is the Playwright-backed entry point.
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import math
import sys
from collections.abc import Iterator

from pydantic import BaseModel, Field

# A4 physical dimensions. CSS resolves at 96px per CSS inch regardless of device.
A4_WIDTH_MM = 210.0
A4_HEIGHT_MM = 297.0
_CSS_PX_PER_INCH = 96.0
_MM_PER_INCH = 25.4

# Tolerance (px) so a block resting exactly on a page line is not mis-flagged.
_BOUNDARY_EPSILON_PX = 1.5


def _mm_to_px(mm: float) -> float:
    return mm * _CSS_PX_PER_INCH / _MM_PER_INCH


@contextlib.contextmanager
def _proactor_loop_policy_on_windows() -> Iterator[None]:
    """Ensure the Proactor event-loop policy while running Playwright on Windows.

    Playwright's sync API spawns its driver as a subprocess. On Windows that needs
    the Proactor loop; if an ambient component (a test, or an app running on a
    Selector loop) set ``WindowsSelectorEventLoopPolicy``, the launch fails with
    ``NotImplementedError``. We swap in the Proactor policy for the duration and
    restore the previous one afterward so we don't disturb the host process.
    """
    if sys.platform != "win32":
        yield
        return
    previous = asyncio.get_event_loop_policy()
    if not isinstance(previous, asyncio.WindowsProactorEventLoopPolicy):
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    try:
        yield
    finally:
        asyncio.set_event_loop_policy(previous)


def page_content_height_px(
    page_height_mm: float = A4_HEIGHT_MM, margin_mm: float = 14.0
) -> float:
    """Usable content height of one printed page, in CSS px.

    ``margin_mm`` is the symmetric top+bottom @page margin used by the template
    (14mm in ``resume.html.j2``).
    """
    return _mm_to_px(page_height_mm - 2 * margin_mm)


def page_content_width_px(
    page_width_mm: float = A4_WIDTH_MM, margin_mm: float = 14.0
) -> float:
    return _mm_to_px(page_width_mm - 2 * margin_mm)


def straddles_boundary(top: float, bottom: float, page_height: float) -> bool:
    """True if ``[top, bottom)`` crosses a page line in continuous flow.

    A block that is itself taller than a page always straddles; callers should
    classify those separately as oversized.
    """
    if page_height <= 0 or bottom <= top:
        return False
    first_page = math.floor((top + _BOUNDARY_EPSILON_PX) / page_height)
    last_page = math.floor((bottom - _BOUNDARY_EPSILON_PX) / page_height)
    return last_page > first_page


class BlockBounds(BaseModel):
    """One atomic, page-break-avoiding block and where it lands in natural flow."""

    label: str
    section: str = ""
    top_px: float
    bottom_px: float
    height_px: float
    natural_page: int = Field(..., description="0-based page in continuous flow.")
    oversized: bool = Field(False, description="Taller than one page → unavoidable bleed.")
    straddles: bool = Field(False, description="Crosses a page line in natural flow.")


class BoundsReport(BaseModel):
    """Result of a bounds analysis pass."""

    page_count: int = Field(..., description="Authoritative printed page count.")
    page_height_px: float
    page_width_px: float
    content_height_px: float = Field(..., description="Total natural document height.")
    fits_one_page: bool
    oversized_blocks: list[BlockBounds] = Field(default_factory=list)
    straddling_blocks: list[BlockBounds] = Field(default_factory=list)
    blocks: list[BlockBounds] = Field(default_factory=list)

    def summary(self) -> str:
        """One-line human-readable verdict."""
        verb = "fits 1 page" if self.fits_one_page else f"spans {self.page_count} pages"
        bleed = ""
        if self.oversized_blocks:
            bleed = f"; {len(self.oversized_blocks)} block(s) too tall for one page"
        return f"Resume {verb}{bleed}."


# JS run in-page after disabling break-inside, so we observe the *natural* flow.
# Each selector is an atomic block the print stylesheet keeps whole.
_COLLECT_JS = r"""
() => {
  const sel = ['.entry', '.edu', '.ach'];
  const out = [];
  const sheet = document.querySelector('main.sheet') || document.body;
  const base = sheet.getBoundingClientRect().top + window.scrollY;
  for (const block of document.querySelectorAll(sel.join(','))) {
    const r = block.getBoundingClientRect();
    const top = r.top + window.scrollY - base;
    const bottom = r.bottom + window.scrollY - base;
    let section = '';
    const secEl = block.closest('section');
    if (secEl) { const h = secEl.querySelector('h2'); if (h) section = h.textContent.trim(); }
    const leadEl = block.querySelector('.lead, .school, .title');
    const label = (leadEl ? leadEl.textContent : block.textContent).trim().replace(/\s+/g, ' ').slice(0, 80);
    out.push({ label, section, top, bottom });
  }
  const docHeight = sheet.getBoundingClientRect().height;
  return { blocks: out, docHeight };
}
"""


def analyze_html_bounds(
    html: str, *, margin_mm: float = 14.0, headless: bool = True
) -> BoundsReport:
    """Render ``html`` print-emulated at A4 and report its page bounds.

    Raises ``RuntimeError`` with actionable guidance if the Chromium browser is
    not available (run ``python -m playwright install chromium``).
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise RuntimeError(
            "Playwright is required for bounds analysis. Install it with "
            "`pip install playwright` then `python -m playwright install chromium`."
        ) from exc

    page_h = page_content_height_px(margin_mm=margin_mm)
    page_w = page_content_width_px(margin_mm=margin_mm)

    with _proactor_loop_policy_on_windows(), sync_playwright() as pw:
        try:
            browser = pw.chromium.launch(headless=headless)
        except Exception as exc:  # pragma: no cover - environment guard
            raise RuntimeError(
                "Could not launch Chromium for bounds analysis. Run "
                "`python -m playwright install chromium` and retry."
            ) from exc
        try:
            page = browser.new_page(viewport={"width": round(page_w), "height": round(page_h)})
            page.set_content(html, wait_until="networkidle")
            page.emulate_media(media="print")

            # Authoritative page count: the actual PDF the print engine produces.
            pdf_bytes = page.pdf(format="A4", margin={"top": f"{margin_mm}mm", "bottom": f"{margin_mm}mm", "left": f"{margin_mm}mm", "right": f"{margin_mm}mm"})
            page_count = _count_pdf_pages(pdf_bytes)

            # Natural flow: disable break-inside so we can see what *would* straddle.
            page.add_style_tag(content="*{break-inside:auto !important;page-break-inside:auto !important;}")
            measured = page.evaluate(_COLLECT_JS)
        finally:
            browser.close()

    blocks: list[BlockBounds] = []
    for raw in measured["blocks"]:
        top = float(raw["top"])
        bottom = float(raw["bottom"])
        height = bottom - top
        oversized = height > page_h
        block = BlockBounds(
            label=raw["label"] or "(untitled)",
            section=raw["section"],
            top_px=top,
            bottom_px=bottom,
            height_px=height,
            natural_page=max(0, math.floor((top + _BOUNDARY_EPSILON_PX) / page_h)),
            oversized=oversized,
            straddles=(not oversized) and straddles_boundary(top, bottom, page_h),
        )
        blocks.append(block)

    return BoundsReport(
        page_count=page_count,
        page_height_px=page_h,
        page_width_px=page_w,
        content_height_px=float(measured["docHeight"]),
        fits_one_page=page_count <= 1,
        oversized_blocks=[b for b in blocks if b.oversized],
        straddling_blocks=[b for b in blocks if b.straddles],
        blocks=blocks,
    )


def _count_pdf_pages(pdf_bytes: bytes) -> int:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    return len(reader.pages)
