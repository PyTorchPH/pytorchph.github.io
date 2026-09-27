"""Non-destructive overlay highlighting + a live debug HUD for the visible scraper.

DevTools-style. Instead of mutating site elements (changing ``element.style`` or
deleting nodes), this draws floating rectangles in a dedicated overlay layer that is
positioned from each target's ``getBoundingClientRect()``, plus a fixed status panel
(the HUD). Nothing in the page's own DOM is altered, so the site's layout is never
disturbed and the scraper reads exactly what it would read in production.

Everything here is opt-in: every public function is a no-op unless visual debug is
enabled (``RESUME_BUILD_PLAYWRIGHT_VISUAL=1`` or a delay/highlight is configured), so
the production headless path never pays for it and unit tests that don't enable visual
mode see zero extra ``page.evaluate`` calls.
"""

from __future__ import annotations

import logging

from .playwright_debug import PlaywrightVisualDebug, visual_debug_from_env

log = logging.getLogger(__name__)

# Overlay palette — semantic, shared with the step-through walk.
POST_COLOR = "#ff2d75"     # red    — the whole post being scraped
COMMENT_COLOR = "#ff7a18"  # orange — comments, highlighted but NOT collected
IMAGE_COLOR = "#f43f5e"    # rose   — media being read/considered
TEXT_COLOR = "#22c55e"     # green  — the text that is actually collected
SHARED_COLOR = "#3b82f6"   # blue   — a reshared post, preserved

# Inject the overlay root, a reusable box-drawer, a clear() and a HUD renderer onto
# ``window`` exactly once. Idempotent: a second call short-circuits on ``__rbBox``.
# Boxes are position:fixed using viewport coordinates captured at draw time — perfect
# for a step debugger that pauses on each element (we redraw every step).
_BOOTSTRAP_JS = """
() => {
  if (window.__rbBox) return true;
  const root = document.createElement('div');
  root.id = '__rb_overlay_root';
  root.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;';
  document.documentElement.appendChild(root);
  const state = { root, rects: [] };
  window.__rbOverlay = state;
  window.__rbBox = (el, color, label, scroll) => {
    if (!el) return null;
    if (scroll) { try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {} }
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = '__rb_rect';
    box.style.cssText =
      'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width +
      'px;height:' + r.height + 'px;border:3px solid ' + color + ';border-radius:6px;' +
      'box-sizing:border-box;box-shadow:0 0 0 4px ' + color + '44;pointer-events:none;';
    if (label) {
      const tag = document.createElement('div');
      tag.textContent = label;
      tag.style.cssText =
        'position:absolute;left:-3px;top:-22px;background:' + color + ';color:#fff;' +
        'font:600 11px/1.4 system-ui,sans-serif;padding:2px 8px;border-radius:4px;white-space:nowrap;';
      box.appendChild(tag);
    }
    state.root.appendChild(box);
    state.rects.push(box);
    return box;
  };
  window.__rbClear = () => {
    const n = state.rects.length;
    state.rects.forEach(b => { try { b.remove(); } catch (e) {} });
    state.rects = [];
    return n;
  };
  const hud = document.createElement('div');
  hud.id = '__rb_hud';
  hud.style.cssText =
    'position:fixed;top:16px;right:16px;min-width:230px;padding:12px 14px;' +
    'background:rgba(17,17,27,.92);color:#f4f4f5;font:600 12px/1.6 ui-monospace,Menlo,monospace;' +
    'border:1px solid rgba(255,255,255,.14);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.45);' +
    'z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(hud);
  window.__rbHud = (rows) => {
    let html =
      '<div style="font-weight:700;letter-spacing:.08em;color:#a5b4fc;margin-bottom:6px;">SCRAPER DEBUG</div>';
    for (const pair of rows) {
      html +=
        '<div style="display:flex;justify-content:space-between;gap:16px;">' +
        '<span style="color:#9ca3af;">' + pair[0] + '</span><span>' + pair[1] + '</span></div>';
    }
    hud.innerHTML = html;
    return true;
  };
  return true;
}
"""

# Draw one rectangle over an element handle. Returns true when a box was appended.
_BOX_JS = "(el, { color, label, scroll }) => (window.__rbBox ? !!window.__rbBox(el, color, label, scroll) : false)"

# Draw rectangles over every match of a selector (capped). Centers the LAST (bottom-
# most) match so the highlight follows the feed downward rather than yanking it back
# up. Self-clears the boxes it drew after ``ms`` so the scroll phase doesn't pile up.
_BOX_SELECTOR_JS = """
({ selector, color, label, ms, scrollLast }) => {
  if (!window.__rbBox) return 0;
  const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 12);
  if (scrollLast && nodes.length) {
    try { nodes[nodes.length - 1].scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch (e) {}
  }
  const drawn = [];
  for (const node of nodes) {
    const box = window.__rbBox(node, color, label, false);
    if (box) drawn.push(box);
  }
  if (ms > 0) {
    window.setTimeout(() => { drawn.forEach(b => { try { b.remove(); } catch (e) {} }); }, ms);
  }
  return nodes.length;
}
"""

_HUD_JS = "(rows) => (window.__rbHud ? window.__rbHud(rows) : false)"
_CLEAR_JS = "() => (window.__rbClear ? window.__rbClear() : 0)"


def ensure_overlay(page, *, debug: PlaywrightVisualDebug | None = None) -> bool:
    """Inject the overlay layer + HUD once. No-op (returns False) unless visual mode."""
    debug = debug or visual_debug_from_env()
    if not debug.enabled:
        return False
    try:
        page.evaluate(_BOOTSTRAP_JS)
        return True
    except Exception as exc:  # noqa: BLE001 - page/browser closed
        log.debug("overlay bootstrap skipped: %s", exc)
        return False


def overlay_box(
    element,
    *,
    color: str,
    label: str = "",
    scroll: bool = True,
    debug: PlaywrightVisualDebug | None = None,
) -> bool:
    """Outline a single element handle with a floating overlay rectangle."""
    debug = debug or visual_debug_from_env()
    if not debug.enabled:
        return False
    try:
        return bool(element.evaluate(_BOX_JS, {"color": color, "label": label, "scroll": scroll}))
    except Exception as exc:  # noqa: BLE001 - detached handle / closed page
        log.debug("overlay box skipped: %s", exc)
        return False


def overlay_selector(
    page,
    selector: str | None,
    *,
    color: str,
    label: str = "",
    ms: int = 900,
    scroll_last: bool = True,
    debug: PlaywrightVisualDebug | None = None,
) -> int:
    """Outline every match of ``selector`` with overlay rectangles (auto-cleared)."""
    debug = debug or visual_debug_from_env()
    if not debug.enabled or not selector:
        return 0
    ensure_overlay(page, debug=debug)
    try:
        return int(
            page.evaluate(
                _BOX_SELECTOR_JS,
                {"selector": selector, "color": color, "label": label, "ms": ms, "scrollLast": scroll_last},
            )
            or 0
        )
    except Exception as exc:  # noqa: BLE001 - page closed
        log.debug("overlay selector skipped: %s", exc)
        return 0


def hud_update(
    page,
    rows: list[tuple[str, str]] | list[list[str]],
    *,
    debug: PlaywrightVisualDebug | None = None,
) -> bool:
    """Render the side status panel from ``[(key, value), ...]`` rows (order kept)."""
    debug = debug or visual_debug_from_env()
    if not debug.enabled:
        return False
    ensure_overlay(page, debug=debug)
    payload = [[str(k), str(v)] for k, v in rows]
    try:
        return bool(page.evaluate(_HUD_JS, payload))
    except Exception as exc:  # noqa: BLE001 - page closed
        log.debug("hud update skipped: %s", exc)
        return False


def clear_overlays(page, *, debug: PlaywrightVisualDebug | None = None) -> int:
    """Remove all currently-drawn highlight rectangles (the HUD is left in place)."""
    debug = debug or visual_debug_from_env()
    if not debug.enabled:
        return 0
    try:
        return int(page.evaluate(_CLEAR_JS) or 0)
    except Exception as exc:  # noqa: BLE001 - page closed
        log.debug("overlay clear skipped: %s", exc)
        return 0
