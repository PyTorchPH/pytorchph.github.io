"""Opt-in visual debugging helpers for Playwright-driven social flows."""

from __future__ import annotations

import os
from dataclasses import dataclass


_TRUE_VALUES = {"1", "true", "yes", "y", "on"}
_DEFAULT_COLORS = ("#ff2d75", "#00d1ff", "#22c55e", "#facc15", "#a855f7")


@dataclass(frozen=True)
class PlaywrightVisualDebug:
    enabled: bool
    delay_ms: int
    highlight_ms: int
    colors: tuple[str, ...]
    force_headed: bool


def visual_debug_from_env() -> PlaywrightVisualDebug:
    """Read visual-debug settings from environment variables.

    `RESUME_BUILD_PLAYWRIGHT_VISUAL=1` turns on a headed browser with colored
    selector highlights and a small pause before key actions.
    """
    visual = _truthy(os.getenv("RESUME_BUILD_PLAYWRIGHT_VISUAL"))
    delay_ms = _int_env("RESUME_BUILD_PLAYWRIGHT_DELAY_MS", 700 if visual else 0)
    highlight_ms = _int_env("RESUME_BUILD_PLAYWRIGHT_HIGHLIGHT_MS", 900 if visual else 0)
    colors = _colors_from_env()
    force_headed = _truthy(os.getenv("RESUME_BUILD_PLAYWRIGHT_FORCE_HEADED"), default=True)
    enabled = visual or delay_ms > 0 or highlight_ms > 0
    return PlaywrightVisualDebug(
        enabled=enabled,
        delay_ms=max(0, delay_ms),
        highlight_ms=max(0, highlight_ms),
        colors=colors,
        force_headed=force_headed,
    )


def launch_options(headless: bool, debug: PlaywrightVisualDebug | None = None) -> dict:
    """Return Chromium launch kwargs, applying visual-debug overrides when enabled."""
    debug = debug or visual_debug_from_env()
    resolved_headless = headless
    headless_env = os.getenv("RESUME_BUILD_PLAYWRIGHT_HEADLESS")
    if headless_env is not None:
        resolved_headless = _truthy(headless_env)
    if debug.enabled and debug.force_headed:
        resolved_headless = False

    options: dict[str, object] = {"headless": resolved_headless}
    # Drive the user's real Google Chrome by default instead of Playwright's
    # bundled Chromium. Override with RESUME_BUILD_PLAYWRIGHT_CHANNEL=chromium
    # (or empty) to fall back to bundled Chromium.
    channel = os.getenv("RESUME_BUILD_PLAYWRIGHT_CHANNEL", "chrome").strip()
    if channel and channel.lower() != "chromium":
        options["channel"] = channel
    if not resolved_headless:
        # Maximize the visible window so the site lays out at full width and the
        # centered highlights sit properly inside the viewport.
        options["args"] = ["--start-maximized"]
    if debug.enabled and debug.delay_ms:
        options["slow_mo"] = debug.delay_ms
    return options


def highlight_selector(
    page,
    selector: str | None,
    *,
    label: str = "",
    debug: PlaywrightVisualDebug | None = None,
) -> None:
    """Outline matching elements briefly so the visible browser shows the logic path.

    Drawing is delegated to the non-destructive overlay layer (floating rectangles
    positioned from each match's bounding box) instead of mutating ``element.style``,
    so the page's own DOM is never touched. The newest (bottom-most) match is centered
    so the highlight follows the feed downward rather than fighting the scroll.
    """
    if not selector:
        return
    debug = debug or visual_debug_from_env()
    if not debug.enabled:
        return

    # Lazy import: playwright_overlay imports from this module, so importing it at the
    # top would be circular.
    from .playwright_overlay import overlay_selector

    color = _pick_color(selector, label, debug.colors)
    highlight_ms = debug.highlight_ms or debug.delay_ms or 700
    overlay_selector(
        page,
        selector,
        color=color,
        label=label,
        ms=highlight_ms,
        scroll_last=True,
        debug=debug,
    )
    pause(page, debug=debug, ms=min(highlight_ms, debug.delay_ms or highlight_ms))


def pause(
    page,
    *,
    debug: PlaywrightVisualDebug | None = None,
    ms: int | None = None,
) -> None:
    """Pause in visual-debug mode without requiring real Playwright in unit tests."""
    debug = debug or visual_debug_from_env()
    if not debug.enabled:
        return
    wait_ms = debug.delay_ms if ms is None else ms
    if wait_ms <= 0:
        return
    try:
        page.wait_for_timeout(wait_ms)
    except Exception:
        return


def _truthy(value: str | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in _TRUE_VALUES


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _colors_from_env() -> tuple[str, ...]:
    raw = os.getenv("RESUME_BUILD_PLAYWRIGHT_HIGHLIGHT_COLORS")
    if not raw:
        return _DEFAULT_COLORS
    colors = tuple(c.strip() for c in raw.split(",") if c.strip())
    return colors or _DEFAULT_COLORS


def _pick_color(selector: str, label: str, colors: tuple[str, ...]) -> str:
    key = f"{label}:{selector}"
    idx = sum(ord(ch) for ch in key) % len(colors)
    return colors[idx]
