"""Lenient LinkedIn login: open a visible Chromium at the login page and poll ONLY
for the li_at cookie (the session-defining cookie). Saves as soon as li_at appears
(+ a short settle), then persists cookies + storage_state. Scratch tool.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "pyproject.toml").exists())
sys.path.insert(0, str(ROOT / "legacy" / "python"))

VENDOR = "linkedin"
LOGIN_URL = "https://www.linkedin.com/login"
TIMEOUT_S = 600.0
POLL_S = 1.5
SETTLE_S = 3.0


def _say(m: str) -> None:
    print(m, flush=True)


def main() -> int:
    from playwright.sync_api import sync_playwright

    from resume_builder.sources.social.auth import SessionStore

    store = SessionStore()
    _say("[li] launching visible Chromium at LinkedIn login (use EMAIL + PASSWORD, not Google)...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(LOGIN_URL)

        deadline = time.monotonic() + TIMEOUT_S
        announced = False
        while time.monotonic() < deadline:
            cookies = {c["name"]: c["value"] for c in context.cookies() if c.get("value")}
            if "li_at" in cookies:
                time.sleep(SETTLE_S)
                cookies = {c["name"]: c["value"] for c in context.cookies() if c.get("value")}
                state = context.storage_state()
                store.save(VENDOR, cookies)
                store.save_storage_state(VENDOR, state)
                browser.close()
                _say(f"[li] SUCCESS — li_at present, {len(cookies)} cookies saved to {store.path(VENDOR)}")
                return 0
            if not announced and "JSESSIONID" in cookies:
                announced = True
                _say("[li] page loaded; complete sign-in (email/password/2FA) in the window...")
            time.sleep(POLL_S)

        browser.close()
        _say("[li] timed out — li_at never appeared. Did sign-in complete in the window?")
        return 5


if __name__ == "__main__":
    sys.exit(main())
