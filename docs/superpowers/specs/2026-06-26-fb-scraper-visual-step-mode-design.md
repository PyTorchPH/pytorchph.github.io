# FB Scraper — Visual Step-Through Debug Mode

**Date:** 2026-06-26
**Status:** Approved (build) — superseded by the overlay redesign below

## Addendum (2026-06-26) — overlay redesign, non-destructive

The step walk was reworked to be **fully non-destructive**. The original design
deleted comments/media from the live DOM for visibility; per follow-up direction it
now **highlights instead of mutates**, so what the user sees is exactly what
production reads. Three changes:

1. **New overlay layer** — `sources/social/playwright_overlay.py`. DevTools-style
   floating rectangles positioned from each target's `getBoundingClientRect()`, drawn
   in a dedicated overlay root (`window.__rbBox`). Nothing in the page DOM is touched.
   Every function is opt-in (no-op unless visual debug is enabled), so the headless
   path and non-visual unit tests see zero extra `page.evaluate` calls.
2. **Live HUD** — a fixed side panel (`window.__rbHud`) showing `Card`, `Status`, and
   `Next` during the step walk, and `Cards loaded` / `Scroll pass` / `Status` during
   `scroll_collect` (so the user can see *why* the scraper waits for new cards).
3. **Per-post sequence** is now: POST (red) → COMMENTS (orange, kept) → IMAGES (rose,
   "reading image") → TEXT (green) → SHARED (blue). No `.remove()`, no `element.style`
   mutation. `highlight_selector` (scroll phase) also delegates to the overlay layer.

The original deletion-based design below is kept for history. The "deletion vs ignore"
production decision is now moot for the debug surface — it never mutates.

---


## Goal

Let the user watch the Facebook scraper work, post by post, in a visible Chrome
window — confirming exactly which DOM elements it focuses on before trusting the
extraction. Comment sections are physically **deleted** from the live DOM (not just
ignored) so the user can see what content actually remains as the post text.

This is a debugging/verification surface. It does not change the production
extraction path; it sits in front of it.

## Decisions (from brainstorming)

- **Advance:** auto-step with a long pause per step (~5s). No manual clicking — the
  user watches. ("Clickable" turned out to mean "slow enough to follow.")
- **Text step:** highlight the cleaned post region that matches current extraction
  (whole article minus comments/chrome) — the honest representation, not an
  idealized text-only container.
- **Comments:** real DOM deletion (`.remove()`) for now, so focus is visible.
- **Scope:** first 3 posts, ~5s/step, by default.

## Per-post step sequence

For each of the first N posts, on the live page:

1. **POST div (red).** Outline the whole `div[role="article"]:not(...)` container,
   label `POST being scraped`. Pause.
2. **TEXT region (green).** Re-outline the same article, label `text source`. Pause.
3. **COMMENTS hit → delete (orange → remove).** Find nested comment articles
   (`aria-label` starting `Comment by` / `Reply by`) plus action chrome
   (`[role="button"]`, `[role="toolbar"]`, `form`, `svg`,
   `[data-visualcompletion="ignore"]`). Flash them orange, then `.remove()` them from
   the DOM so the user watches them vanish. Pause. Shared posts are preserved (only
   comment-labelled articles are removed).

After the walk, normal snapshot/extraction proceeds over ALL collected posts, so the
run still returns real output.

## Architecture

New module `sources/social/playwright_step.py` — kept separate from
`playwright_debug.py` because it performs **active DOM mutation** (deletion), whereas
`playwright_debug.py` is passive highlighting.

Public surface:

- `step_limit_from_env() -> int` — `RESUME_BUILD_PLAYWRIGHT_STEP_LIMIT`, default `0`
  (off).
- `step_delay_ms_from_env() -> int` — `RESUME_BUILD_PLAYWRIGHT_STEP_DELAY_MS`,
  default `5000`. **Decoupled from global `slow_mo`** so the scroll-collect phase
  isn't crawled to a halt; only the step-walk uses this long pause.
- `step_through_articles(page, selector, *, limit=None, debug=None) -> int` — runs the
  per-post walk on the first `limit` articles, returns how many were stepped.

Integration point: `FacebookVendor._scrape_articles`, after `scroll_collect` returns
the article handles and before the snapshot loop, inside the live `PlaywrightSession`
context:

```python
limit = step_limit_from_env()
if limit:
    step_through_articles(page, _POST_ARTICLE_SELECTOR, limit=limit)
```

Launch: new `--step` flag on `resume-build scrape`. `_apply_step_env(step, step_limit)`
sets `RESUME_BUILD_PLAYWRIGHT_VISUAL=1`, `RESUME_BUILD_PLAYWRIGHT_STEP_LIMIT` (default
3), and `RESUME_BUILD_PLAYWRIGHT_STEP_DELAY_MS` (default 5000) — all via `setdefault`
so explicit env/flags override. Global `--delay-ms` stays at its modest visual default
so collection remains watchable but not glacial.

## Deletion vs ignore (deferred decision)

Step mode deletes for visibility. The production extraction still uses the existing
clone-and-skip (ignore) path. Once the user is satisfied with what they see, we decide
whether production extraction should switch to deletion-based (mutate then read) or
stay ignore-based (clone then skip) — a speed-vs-accuracy call. The step module
isolates the deletion JS so it can be reused if we go deletion-based.

## Testing

`tests/unit/social/test_playwright_step.py` + a CLI helper test:

- `step_limit_from_env` / `step_delay_ms_from_env` parsing (default, set, garbage).
- `step_through_articles` walks only `limit` articles; no-op at limit 0; each stepped
  article's evaluate calls include the `comment by` deletion JS; shared posts kept.
- `_apply_step_env` sets the right env vars when on, no-ops when off.

No real browser in unit tests (MagicMock page/elements), matching existing
`test_playwright_debug.py` / `test_scroll_collect.py` style.

## Anti-goals

- Don't make step/visual the production default — `STEP_LIMIT` defaults to 0.
- Don't slow the whole Playwright session with a 5s global `slow_mo`.
- Don't delete shared posts; only comment-labelled articles.
