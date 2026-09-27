"""Interactive element picker for the visible scraper — DevTools-style.

Injects a hover-inspector into the live page: the element under the cursor is
outlined (with a tag/size tooltip), and when the user clicks, that element is
"locked" as the scraping target — everything else is dimmed (spotlight effect) so
it reads as skipped. The picked element's CSS path + text are stashed on
``window.__rbPicked`` for the Python side to read back.

This lets a human override FB's messy auto-detection by simply clicking the div that
holds the content to scrape, instead of trusting a brittle selector.
"""

from __future__ import annotations

import logging
import time

log = logging.getLogger(__name__)

PICK_ACCENT = "#3b82f6"
PICK_LOCKED = "#22c55e"

# Inject the hover-inspector + click-to-lock picker. Idempotent via window.__rbPicker.
_INJECT_PICKER_JS = """
({ accent, locked }) => {
  if (window.__rbPicker) return true;

  const hov = document.createElement('div');
  hov.id = '__rb_pick_hover';
  hov.style.cssText =
    'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid ' + accent +
    ';background:' + accent + '22;border-radius:4px;transition:all 40ms linear;';
  document.documentElement.appendChild(hov);

  const tip = document.createElement('div');
  tip.id = '__rb_pick_tip';
  tip.style.cssText =
    'position:fixed;pointer-events:none;z-index:2147483647;background:#111827;color:#fff;' +
    'font:600 11px/1.4 ui-monospace,monospace;padding:3px 7px;border-radius:4px;max-width:60vw;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  document.documentElement.appendChild(tip);

  const banner = document.createElement('div');
  banner.id = '__rb_pick_banner';
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:' + accent +
    ';color:#fff;font:700 13px/1.6 system-ui,sans-serif;text-align:center;padding:8px;pointer-events:none;';
  banner.textContent = 'PICK MODE — i-click ang DIV na gusto mong i-scrape (ang iba skipped). ESC to cancel.';
  document.documentElement.appendChild(banner);

  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const role = el.getAttribute && el.getAttribute('role');
    if (role) s += '[role=' + role + ']';
    const cls = (el.className && el.className.toString) ? el.className.toString().trim().split(/\\s+/).slice(0, 2).join('.') : '';
    if (cls) s += '.' + cls;
    return s;
  };
  const cssPath = (el) => {
    const parts = [];
    while (el && el.nodeType === 1 && el.tagName !== 'HTML') {
      let sel = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        if (sibs.length > 1) sel += ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
      }
      parts.unshift(sel);
      el = el.parentElement;
    }
    return parts.join(' > ');
  };

  let current = null;
  const onMove = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === hov || el === tip || el === banner) return;
    current = el;
    const r = el.getBoundingClientRect();
    hov.style.left = r.left + 'px'; hov.style.top = r.top + 'px';
    hov.style.width = r.width + 'px'; hov.style.height = r.height + 'px';
    tip.style.left = Math.max(4, r.left) + 'px';
    tip.style.top = Math.max(28, r.top - 22) + 'px';
    tip.textContent = describe(el) + '  ·  ' + Math.round(r.width) + '×' + Math.round(r.height);
  };
  const onClick = (e) => {
    if (!current) return;
    e.preventDefault(); e.stopPropagation();
    const el = current;
    const r = el.getBoundingClientRect();
    hov.style.border = '3px solid ' + locked;
    hov.style.background = locked + '22';
    banner.style.background = locked;
    banner.textContent = 'PICKED — ito ang i-sscrape; lahat ng iba skipped.';
    // Spotlight: dim everything except the picked element.
    const spot = document.createElement('div');
    spot.id = '__rb_pick_spot';
    spot.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483645;left:' + r.left + 'px;top:' + r.top +
      'px;width:' + r.width + 'px;height:' + r.height +
      'px;box-shadow:0 0 0 9999px rgba(0,0,0,.6);border-radius:6px;';
    document.documentElement.appendChild(spot);
    window.__rbPicked = {
      selector: cssPath(el),
      describe: describe(el),
      text: (el.innerText || '').trim().slice(0, 4000),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    };
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
  };
  const onKey = (e) => { if (e.key === 'Escape') window.__rbPicked = { cancelled: true }; };

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  window.__rbPicker = true;
  return true;
}
"""

_READ_PICK_JS = "() => window.__rbPicked || null"


def inject_picker(page, *, accent: str = PICK_ACCENT, locked: str = PICK_LOCKED) -> bool:
    """Install the hover-inspector + click-to-lock picker onto the live page."""
    try:
        return bool(page.evaluate(_INJECT_PICKER_JS, {"accent": accent, "locked": locked}))
    except Exception as exc:  # noqa: BLE001 - page/browser closed
        log.debug("picker inject skipped: %s", exc)
        return False


def read_pick(page) -> dict | None:
    """Return the picked element info (or ``{'cancelled': True}``), else None."""
    try:
        return page.evaluate(_READ_PICK_JS)
    except Exception as exc:  # noqa: BLE001
        log.debug("read pick skipped: %s", exc)
        return None


def wait_for_pick(page, *, timeout_s: float = 120.0, poll_s: float = 0.4) -> dict | None:
    """Block until the user clicks an element (or cancels / times out).

    Returns the pick dict, ``{'cancelled': True}`` on ESC, or None on timeout.
    """
    inject_picker(page)
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        pick = read_pick(page)
        if pick:
            return pick
        try:
            page.wait_for_timeout(int(poll_s * 1000))
        except Exception:  # noqa: BLE001 - page closed mid-wait
            return None
    return None
