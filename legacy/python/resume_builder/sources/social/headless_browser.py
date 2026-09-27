"""Playwright scrape session — visible Chromium by default, with scroll-to-load.

Despite the file name (kept for import-path stability), the default ``headless``
value is ``False``: the user sees the same Chromium that signed them in, navigating
their feed and pulling posts. Visible mode also reduces bot-detection noise that
fully-headless Chromium triggers on Facebook and LinkedIn.

A scroll helper drives infinite-scroll feeds so the scraper captures every post,
not just the first viewport.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator

from .auth import SessionStore
from .browser_login import PlaywrightNotInstalled, _resolve_playwright
from .playwright_debug import (
    highlight_selector,
    launch_options,
    pause,
    visual_debug_from_env,
)
from .playwright_overlay import ensure_overlay, hud_update
from .browser_login import _cdp_url_from_env

log = logging.getLogger(__name__)


class NoStoredSessionError(RuntimeError):
    """Raised when ``storage_state.json`` for the requested vendor is missing.

    Callers can catch this and fall back to a curl-only path.
    """


@contextmanager
def PlaywrightSession(  # noqa: N802 - context-manager helper
    vendor: str,
    *,
    headless: bool = False,
    playwright_module=None,
    store: SessionStore | None = None,
    timeout_ms: int = 30_000,
) -> Iterator[object]:
    """Yield a Playwright ``page`` bound to the vendor's stored authenticated context."""
    store = store or SessionStore()
    state = store.load_storage_state(vendor)
    if state is None:
        raise NoStoredSessionError(
            f"No stored sign-in for {vendor}. Run `resume-build login` first."
        )
    sync_playwright = _resolve_playwright(playwright_module)
    visual_debug = visual_debug_from_env()

    with sync_playwright() as p:
        opts = launch_options(headless, visual_debug)
        cdp_url = _cdp_url_from_env()
        if cdp_url:
            browser = p.chromium.connect_over_cdp(cdp_url)
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            page = context.new_page()
        else:
            browser = p.chromium.launch(**opts)
            context_kwargs = {"storage_state": state}
            if "--start-maximized" in (opts.get("args") or []):
                context_kwargs["no_viewport"] = True
            context = browser.new_context(**context_kwargs)
            context.set_default_timeout(timeout_ms)
            page = context.new_page()
            
        try:
            highlight_selector(page, "body", label=f"{vendor} session ready", debug=visual_debug)
            yield page
        finally:
            try:
                browser.close()
            except Exception as exc:  # noqa: BLE001
                log.debug("browser close after session: %s", exc)


# Backwards-compatible alias for older imports.
HeadlessBrowser = PlaywrightSession


def scroll_collect(
    page,
    item_selector: str,
    *,
    max_scrolls: int = 60,
    settle_ms: int = 1500,
    no_growth_passes: int = 3,
) -> list:
    """Scroll the page until ``item_selector`` stops growing, then return all matches.

    ``max_scrolls`` is the hard cap on scroll cycles; ``no_growth_passes`` is how
    many consecutive scrolls with the same item count we tolerate before declaring
    the feed exhausted (Facebook sometimes lazy-loads with a small delay).
    """
    visual_debug = visual_debug_from_env()
    # In visual mode, wait noticeably longer for each batch to render so the user
    # can watch the content load instead of the page racing ahead of it.
    load_wait_ms = (
        max(settle_ms, visual_debug.delay_ms * 3)
        if visual_debug.enabled and visual_debug.delay_ms
        else settle_ms
    )
    ensure_overlay(page, debug=visual_debug)
    seen = 0
    flat = 0
    for cycle in range(max_scrolls):
        highlight_selector(
            page,
            item_selector,
            label="items collected before scroll",
            debug=visual_debug,
        )
        try:
            items = page.query_selector_all(item_selector) or []
        except Exception as exc:  # noqa: BLE001 - page/browser closed mid-scroll
            log.info("scroll stopped early (page closed?): %s", exc)
            return []
        # Live HUD: the user can see WHY the scraper waits — count hasn't grown yet,
        # so it holds instead of racing ahead of the lazy-loaded feed.
        hud_update(
            page,
            [
                ("Cards loaded", len(items)),
                ("Scroll pass", f"{cycle + 1}/{max_scrolls}"),
                ("Status", "growing" if len(items) > seen else "waiting for new cards"),
            ],
            debug=visual_debug,
        )
        if len(items) > seen:
            seen = len(items)
            flat = 0
        else:
            flat += 1
            # If we haven't found any items yet, allow more passes (e.g. scrolling past large headers)
            allowed_passes = no_growth_passes if seen > 0 else max(no_growth_passes, 10)
            if flat >= allowed_passes:
                break
        prev = len(items)
        try:
            page.evaluate("window.scrollBy(0, window.innerHeight * 0.85)")
            # Only move on once new items have actually rendered, so each batch is
            # visibly loaded before the next scroll. Times out gracefully at the
            # end of the feed (no new content within the window).
            try:
                page.wait_for_function(
                    "({ sel, n }) => document.querySelectorAll(sel).length > n",
                    arg={"sel": item_selector, "n": prev},
                    timeout=load_wait_ms,
                )
            except Exception as exc:  # noqa: BLE001 - no growth = likely feed end
                log.debug("no new content within %dms: %s", load_wait_ms, exc)
            pause(page, debug=visual_debug)
            page.wait_for_timeout(settle_ms)
        except Exception as exc:  # noqa: BLE001 - closed window or navigation
            log.debug("scroll failed: %s", exc)
            break
    highlight_selector(page, item_selector, label="final collected items", debug=visual_debug)
    try:
        return page.query_selector_all(item_selector) or []
    except Exception as exc:  # noqa: BLE001 - page closed before final read
        log.info("final collect skipped (page closed?): %s", exc)
        return []


def fetch_rendered_html(
    vendor: str,
    url: str,
    *,
    wait_for_selector: str | None = None,
    timeout_ms: int = 30_000,
    headless: bool = False,
    playwright_module=None,
    store: SessionStore | None = None,
) -> str:
    """Open ``url`` with the vendor's authenticated context, return the page HTML.

    Returns ``""`` on any internal failure so callers can check truthiness.
    """
    visual_debug = visual_debug_from_env()
    try:
        with PlaywrightSession(
            vendor,
            headless=headless,
            playwright_module=playwright_module,
            store=store,
            timeout_ms=timeout_ms,
        ) as page:
            page.goto(url, wait_until="domcontentloaded")
            highlight_selector(page, "body", label="loaded page", debug=visual_debug)
            if wait_for_selector:
                try:
                    highlight_selector(
                        page,
                        wait_for_selector,
                        label="wait target",
                        debug=visual_debug,
                    )
                    page.wait_for_selector(wait_for_selector, timeout=timeout_ms)
                    highlight_selector(
                        page,
                        wait_for_selector,
                        label="wait target ready",
                        debug=visual_debug,
                    )
                except Exception as exc:  # noqa: BLE001
                    log.debug("wait_for_selector %s missed: %s", wait_for_selector, exc)
            return page.content() or ""
    except (NoStoredSessionError, PlaywrightNotInstalled):
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("Playwright fetch %s failed: %s", url, exc)
        return ""
