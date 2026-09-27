"""Playwright-driven sign-in: the only login UX an end user should see.

Tool opens a real Chromium window pointed at the vendor's login URL. The user does
exactly what they would do anywhere else — type credentials, complete 2FA, solve any
CAPTCHA. While that happens we poll the browser context's cookie jar; when the
vendor's session-defining cookie appears we wait a short settle window, grab every
cookie, and close the browser.

No DevTools, no curl, no library decryption — the same TLS session the user
authenticated through is the one whose cookies we keep.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from dataclasses import dataclass

from .playwright_debug import highlight_selector, launch_options, visual_debug_from_env

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class VendorConfig:
    """Per-vendor selector + URL data sourced from DevTools analysis of each login page."""

    url: str
    success_cookie: str
    # Optional: an element whose appearance also signals a successful sign-in.
    success_selector: str | None
    # Optional: substring that must appear in ``page.url`` for the login to be
    # considered complete (matches the ``page.waitForURL`` heuristic the FB
    # DevTools AI suggests). When None, URL is not part of the success check.
    success_url_contains: str | None
    # Optional: form field where we can pre-fill a username/email to save a step.
    username_selector: str | None
    # Optional: heuristic to detect that the vendor is asking for a 2FA code.
    twofa_selector: str | None


_VENDOR_CONFIG: dict[str, VendorConfig] = {
    "facebook": VendorConfig(
        url="https://www.facebook.com/",
        success_cookie="c_user",
        success_selector="div[role='main']",
        # After login, FB lands on www.facebook.com/ — login forms live under
        # the same host but with paths like /login.php, /checkpoint/, etc.
        success_url_contains="facebook.com/",
        username_selector="input#email",
        twofa_selector="input#approvals_code",
    ),
    "twitter": VendorConfig(
        url="https://x.com/i/flow/login",
        success_cookie="auth_token",
        success_selector="[data-testid='primaryColumn']",
        success_url_contains="x.com/home",
        username_selector="input[autocomplete='username']",
        twofa_selector="input[autocomplete='one-time-code']",
    ),
    "linkedin": VendorConfig(
        url="https://www.linkedin.com/login",
        success_cookie="li_at",
        success_selector="main",
        success_url_contains="linkedin.com/feed",
        username_selector="input#username",
        twofa_selector="input#input__phone_verification_pin",
    ),
    "instagram": VendorConfig(
        url="https://www.instagram.com/accounts/login/",
        success_cookie="sessionid",
        success_selector="main[role='main']",
        success_url_contains="instagram.com/",
        username_selector="input[name='username']",
        twofa_selector="input[name='verificationCode']",
    ),
}


class PlaywrightNotInstalled(RuntimeError):
    """Raised when ``playwright`` isn't importable so the CLI can print install hints."""


@dataclass(frozen=True)
class BrowserLoginResult:
    cookies: dict[str, str]
    storage_state: dict | None


@dataclass(frozen=True)
class _BrowserSession:
    browser: object
    context: object
    page: object
    connected_over_cdp: bool


def open_login_window(
    vendor: str,
    *,
    prefill_username: str | None = None,
    poll_seconds: float = 1.5,
    timeout_seconds: float = 600.0,
    settle_seconds: float = 2.0,
    playwright_module=None,
    on_twofa_detected=None,
) -> BrowserLoginResult:
    """Open a real Chromium window for the vendor; return cookies after sign-in.

    ``prefill_username`` types the username into the vendor's username field
    automatically (selectors come from each vendor's DevTools analysis), so the user
    only has to type the password + any 2FA code.

    ``on_twofa_detected`` is invoked once when the 2FA input appears — the CLI uses
    this to print a hint like "Enter the code from your authenticator in the window".

    ``playwright_module`` is for tests; production leaves it ``None``.
    """
    with _PlaywrightEventLoopPolicy():
        return _open_login_window_inner(
            vendor,
            prefill_username=prefill_username,
            poll_seconds=poll_seconds,
            timeout_seconds=timeout_seconds,
            settle_seconds=settle_seconds,
            playwright_module=playwright_module,
            on_twofa_detected=on_twofa_detected,
        )


def _open_login_window_inner(
    vendor: str,
    *,
    prefill_username: str | None,
    poll_seconds: float,
    timeout_seconds: float,
    settle_seconds: float,
    playwright_module,
    on_twofa_detected,
) -> BrowserLoginResult:
    sync_playwright = _resolve_playwright(playwright_module)

    cfg = _VENDOR_CONFIG.get(vendor)
    if cfg is None:
        raise RuntimeError(f"No login config for vendor: {vendor}")

    visual_debug = visual_debug_from_env()
    with sync_playwright() as p:
        session = _open_browser_session(p, visual_debug)
        context = session.context
        page = session.page
        page.goto(cfg.url)
        highlight_selector(page, "body", label=f"{vendor} login page", debug=visual_debug)

        if vendor == "linkedin" and _env_truthy("RESUME_BUILD_LINKEDIN_GOOGLE_LOGIN"):
            page = _try_linkedin_google_signin(
                page,
                prefill_username=prefill_username,
                debug=visual_debug,
            )

        if prefill_username and cfg.username_selector:
            try:
                highlight_selector(
                    page,
                    cfg.username_selector,
                    label=f"{vendor} username field",
                    debug=visual_debug,
                )
                page.wait_for_selector(cfg.username_selector, timeout=10_000)
                highlight_selector(
                    page,
                    cfg.username_selector,
                    label=f"{vendor} username fill",
                    debug=visual_debug,
                )
                page.fill(cfg.username_selector, prefill_username)
            except Exception as exc:  # noqa: BLE001
                log.debug("prefill skipped (selector %s not ready): %s", cfg.username_selector, exc)

        notified_twofa = False
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            cookies = _jar_to_dict(context.cookies())
            has_success_cookie = cfg.success_cookie in cookies
            if has_success_cookie:
                time.sleep(settle_seconds)
                cookies = _jar_to_dict(context.cookies())
                state = context.storage_state()
                _close_browser_session(session)
                return BrowserLoginResult(cookies=cookies, storage_state=state)

            if (
                not notified_twofa
                and cfg.twofa_selector
                and on_twofa_detected
                and _selector_present(page, cfg.twofa_selector)
            ):
                notified_twofa = True
                highlight_selector(
                    page,
                    cfg.twofa_selector,
                    label=f"{vendor} 2fa field",
                    debug=visual_debug,
                )
                try:
                    on_twofa_detected(vendor)
                except Exception:  # noqa: BLE001 - never let a CLI callback derail login
                    pass

            time.sleep(poll_seconds)

        _close_browser_session(session)
        raise TimeoutError(
            f"login window timed out for {vendor} — no `{cfg.success_cookie}` cookie set."
        )


class _PlaywrightEventLoopPolicy:
    """Use a Windows loop policy that can spawn Playwright's driver process."""

    def __enter__(self):
        self._previous = None
        if sys.platform == "win32":
            self._previous = asyncio.get_event_loop_policy()
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        return self

    def __exit__(self, exc_type, exc, tb):
        if self._previous is not None:
            asyncio.set_event_loop_policy(self._previous)
        return False


def _open_browser_session(p, visual_debug) -> _BrowserSession:
    cdp_url = _cdp_url_from_env()
    if cdp_url:
        browser = p.chromium.connect_over_cdp(cdp_url)
        context = browser.contexts[0] if browser.contexts else browser.new_context()
        page = context.new_page()
        return _BrowserSession(
            browser=browser,
            context=context,
            page=page,
            connected_over_cdp=True,
        )

    browser = p.chromium.launch(**launch_options(False, visual_debug))
    context = browser.new_context()
    page = context.new_page()
    return _BrowserSession(
        browser=browser,
        context=context,
        page=page,
        connected_over_cdp=False,
    )


def _close_browser_session(session: _BrowserSession) -> None:
    if session.connected_over_cdp:
        # Keep the user's real Chrome open; only close the social-login tab.
        try:
            session.page.close()
        except Exception:  # noqa: BLE001
            pass
        return
    session.browser.close()


def _cdp_url_from_env() -> str:
    url = os.getenv("RESUME_BUILD_PLAYWRIGHT_CDP_URL", "").strip()
    if url:
        return url
    port = os.getenv("RESUME_BUILD_PLAYWRIGHT_CDP_PORT", "").strip()
    if port:
        return f"http://127.0.0.1:{port}"
    return ""


def _try_linkedin_google_signin(page, *, prefill_username: str | None, debug):
    selectors = (
        "button:has-text('Continue with Google')",
        "button:has-text('Sign in with Google')",
        "text=Continue with Google",
        "text=Sign in with Google",
        "[aria-label*='Google']",
    )
    for selector in selectors:
        try:
            locator = page.locator(selector).first()
            if locator.count() < 1:
                continue
            highlight_selector(
                page,
                selector,
                label="linkedin google sign-in",
                debug=debug,
            )
            popup = None
            try:
                with page.expect_popup(timeout=5_000) as popup_info:
                    locator.click(timeout=5_000)
                popup = popup_info.value
            except Exception:  # noqa: BLE001
                locator.click(timeout=5_000)
            active_page = popup or page
            _try_choose_google_account(active_page, prefill_username=prefill_username)
            return active_page
        except Exception as exc:  # noqa: BLE001
            log.debug("linkedin google sign-in selector skipped (%s): %s", selector, exc)
    return page


def _try_choose_google_account(page, *, prefill_username: str | None) -> None:
    if not prefill_username:
        return
    try:
        page.get_by_text(prefill_username, exact=False).click(timeout=5_000)
    except Exception as exc:  # noqa: BLE001
        log.debug("google account auto-select skipped for %s: %s", prefill_username, exc)


def _env_truthy(name: str, *, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _selector_present(page, selector: str | None) -> bool:
    """Return True if selector is None (no constraint) or the element is visible."""
    if not selector:
        return True
    try:
        element = page.query_selector(selector)
        return bool(element)
    except Exception:  # noqa: BLE001
        return False


def _url_matches(page, pattern: str | None) -> bool:
    """Return True if ``pattern`` appears anywhere in ``page.url``.

    Matches the spirit of Playwright's ``page.waitForURL`` substring check that the
    FB DevTools AI snippet uses — after a successful login the address bar must
    have already moved to a page on the vendor's domain.
    """
    if not pattern:
        return True
    try:
        current = getattr(page, "url", "") or ""
        return pattern in current
    except Exception:  # noqa: BLE001
        return False


def _resolve_playwright(injected):
    if injected is not None:
        return injected
    try:
        from playwright.sync_api import sync_playwright  # type: ignore[import-not-found]
    except ImportError as exc:
        raise PlaywrightNotInstalled(
            "playwright is not installed. Run:\n"
            "  pip install playwright\n"
            "  playwright install chromium"
        ) from exc
    return sync_playwright


def _jar_to_dict(jar) -> dict[str, str]:
    return {c["name"]: c["value"] for c in jar or [] if c.get("value")}
