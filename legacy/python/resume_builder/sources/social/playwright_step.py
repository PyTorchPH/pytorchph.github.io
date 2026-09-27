"""Visible, slow, per-post step-through for the social scraper.

A DevTools-style *visual debugger*: it walks the first N collected posts one at a
time and, for each, paints a sequence of overlay rectangles so the user can watch
exactly what the scraper focuses on — and a side HUD panel reports progress. Unlike
the old behaviour, it is fully **non-destructive**: nothing in the page DOM is
deleted or restyled. Highlighting is done in a separate overlay layer
(``playwright_overlay``), so what the user sees is exactly what production reads.

Five stages per post:
  1. POST     (red)    — outline the whole post: "this is all I look at".
  2. COMMENTS (orange) — outline nested comment articles: highlighted but NOT collected.
  3. IMAGES   (rose)   — outline each image/video being read.
  4. TEXT     (green)  — outline the caption text blocks ONLY (separate from media):
                         the text that is actually collected.
  5. SHARED   (blue)   — if this is a reshare, outline the shared post as preserved.

Enabled only when ``RESUME_BUILD_PLAYWRIGHT_STEP_LIMIT`` is a positive integer — off
(0) by default. The long per-step pause is decoupled from the global ``slow_mo`` so
the scroll-collect phase isn't crawled to a halt.
"""

from __future__ import annotations

import logging
import os

from .playwright_debug import PlaywrightVisualDebug, pause, visual_debug_from_env
from .playwright_overlay import (
    POST_COLOR,
    clear_overlays,
    ensure_overlay,
    hud_update,
    overlay_box,
)

log = logging.getLogger(__name__)

# Outline each nested comment article (orange). Shared posts are preserved: only
# articles whose aria-label marks them as a comment/reply are targeted. Returns the
# number of comment articles highlighted. Draws via the shared overlay box-drawer.
_BOX_COMMENTS_JS = """
el => {
  if (!window.__rbBox) return 0;
  const comments = Array.from(el.querySelectorAll('[role="article"]')).filter(n => {
    const label = n.getAttribute('aria-label') || '';
    return /^\\s*comment by/i.test(label) || /^\\s*reply by/i.test(label);
  });
  comments.forEach(n => window.__rbBox(n, '#ff7a18', 'comment (skipped)', false));
  return comments.length;
}
"""

# Outline each image/video being retrieved (rose), as a region SEPARATE from the text.
# Media inside a preserved shared post is left un-highlighted so the shared context
# reads as one unit. Returns the count.
_BOX_MEDIA_JS = """
el => {
  if (!window.__rbBox) return 0;
  const shared = Array.from(el.querySelectorAll('[role="article"]')).find(n => {
    const label = n.getAttribute('aria-label') || '';
    return !/^\\s*comment by/i.test(label) && !/^\\s*reply by/i.test(label);
  });
  const media = Array.from(el.querySelectorAll('img, video, [role="img"]'))
    .filter(n => !(shared && shared.contains(n)));
  media.forEach(n => window.__rbBox(n, '#f43f5e', 'retrieve picture', false));
  return media.length;
}
"""

# Outline the caption TEXT blocks ONLY (green) — each div[dir="auto"] that holds real
# text and isn't part of a comment subtree. Boxing the text divs (not the whole post)
# keeps the text region visibly SEPARATE from the picture region. Returns the count.
_BOX_TEXT_JS = """
el => {
  if (!window.__rbBox) return 0;
  let count = 0;
  el.querySelectorAll('div[dir="auto"]').forEach(d => {
    const art = d.closest('[role="article"]');
    if (art && art !== el) {
      const label = art.getAttribute('aria-label') || '';
      if (/^\\s*comment by/i.test(label) || /^\\s*reply by/i.test(label)) return;  // skip comments
    }
    if ((d.innerText || '').trim().length < 2) return;
    window.__rbBox(d, '#22c55e', 'retrieve text', false);
    count++;
  });
  return count;
}
"""

# Outline a nested reshared post (a nested article that is NOT a comment) in blue so
# the user sees it is preserved, not skipped. Returns true when a shared post exists.
_BOX_SHARED_JS = """
el => {
  if (!window.__rbBox) return false;
  const shared = Array.from(el.querySelectorAll('[role="article"]')).find(n => {
    const label = n.getAttribute('aria-label') || '';
    return !/^\\s*comment by/i.test(label) && !/^\\s*reply by/i.test(label);
  });
  if (!shared) return false;
  window.__rbBox(shared, '#3b82f6', 'SHARED (preserved)', false);
  return true;
}
"""


def step_limit_from_env() -> int:
    """How many posts to walk in slow step mode. 0 (default) disables step mode."""
    return _int_env("RESUME_BUILD_PLAYWRIGHT_STEP_LIMIT", 0)


def step_delay_ms_from_env() -> int:
    """Pause (ms) held on each step so the user can follow along. Default 5s."""
    return _int_env("RESUME_BUILD_PLAYWRIGHT_STEP_DELAY_MS", 5000)


def step_through_articles(
    page,
    selector: str,
    *,
    limit: int | None = None,
    debug: PlaywrightVisualDebug | None = None,
) -> int:
    """Slowly walk the first ``limit`` posts, painting what the scraper reads.

    Returns the number of posts stepped through. A no-op when ``limit`` resolves to 0.
    """
    limit = step_limit_from_env() if limit is None else limit
    if limit <= 0:
        return 0

    debug = debug or visual_debug_from_env()
    delay_ms = step_delay_ms_from_env()
    ensure_overlay(page, debug=debug)

    try:
        articles = page.query_selector_all(selector) or []
    except Exception as exc:  # noqa: BLE001 - page/browser closed
        log.info("step-through skipped (page closed?): %s", exc)
        return 0

    total = min(limit, len(articles))
    stepped = 0
    for index, article in enumerate(articles[:limit]):
        try:
            _step_one(page, article, index, total=total, debug=debug, delay_ms=delay_ms)
            stepped += 1
        except Exception as exc:  # noqa: BLE001 - one bad card shouldn't abort the walk
            log.debug("step-through failed on article %d: %s", index, exc)
    _hud(page, debug, card=f"{stepped}/{total}", status="Done", action="extract all posts")
    log.info("step-through walked %d post(s)", stepped)
    return stepped


def _step_one(
    page,
    article,
    index: int,
    *,
    total: int,
    debug: PlaywrightVisualDebug,
    delay_ms: int,
) -> None:
    n = index + 1
    clear_overlays(page, debug=debug)  # fresh canvas per post

    # 1. The whole post — "this is all I look at".
    _hud(page, debug, card=f"{n}/{total}", status="Reading post", action="scan comments")
    overlay_box(article, color=POST_COLOR, label=f"POST #{n} — ito ang sini-scrape", scroll=True, debug=debug)
    pause(page, debug=debug, ms=delay_ms)

    # 2. Comments — highlighted but never collected (kept in the DOM).
    comments = article.evaluate(_BOX_COMMENTS_JS)
    _hud(page, debug, card=f"{n}/{total}", status=f"Skipping {comments} comment(s)", action="scan media")
    pause(page, debug=debug, ms=delay_ms)

    # 3. Pictures/videos being retrieved — a SEPARATE region from the text.
    media = article.evaluate(_BOX_MEDIA_JS)
    _hud(page, debug, card=f"{n}/{total}", status=f"Retrieve picture ({media})", action="retrieve text")
    pause(page, debug=debug, ms=delay_ms)

    # 4. The caption TEXT blocks only — boxed separately from the picture.
    text_blocks = article.evaluate(_BOX_TEXT_JS)
    _hud(page, debug, card=f"{n}/{total}", status=f"Retrieve text ({text_blocks})", action="next card")
    pause(page, debug=debug, ms=delay_ms)

    # 5. Shared post (if any) — preserved, never skipped.
    if article.evaluate(_BOX_SHARED_JS):
        log.debug("post #%d: shared post preserved", n)
        _hud(page, debug, card=f"{n}/{total}", status="Shared post (kept)", action="next card")
        pause(page, debug=debug, ms=delay_ms)


def _hud(page, debug, *, card: str, status: str, action: str) -> None:
    hud_update(
        page,
        [("Card", card), ("Status", status), ("Next", action)],
        debug=debug,
    )


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default
