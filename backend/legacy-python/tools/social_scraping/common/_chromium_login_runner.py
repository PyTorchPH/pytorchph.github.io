"""One-shot launcher: open a visible Chromium Facebook login window and persist
cookies + storage_state via SessionStore. Writes progress to stdout (line-buffered)
so a parent process can monitor it. Not part of the package — a scratch runner.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "pyproject.toml").exists())
sys.path.insert(0, str(ROOT / "legacy" / "python"))

VENDOR = "facebook"


def _say(msg: str) -> None:
    print(msg, flush=True)


def main() -> int:
    _say(f"[runner] starting Chromium login for vendor={VENDOR}")

    try:
        from resume_builder.sources.social.auth import SessionStore
        from resume_builder.sources.social.browser_login import (
            PlaywrightNotInstalled,
            open_login_window,
        )
    except Exception as exc:  # noqa: BLE001
        _say(f"[runner] import failed: {exc!r}")
        return 3

    store = SessionStore()

    def _twofa(vendor: str) -> None:
        _say(f"[runner] 2FA prompt detected for {vendor} — enter the code in the window")

    try:
        _say("[runner] launching visible Chromium window (headless=False)...")
        result = open_login_window(
            VENDOR,
            prefill_username=None,
            on_twofa_detected=_twofa,
            timeout_seconds=600.0,
        )
    except PlaywrightNotInstalled as exc:
        _say(f"[runner] playwright/chromium not installed: {exc}")
        return 4
    except TimeoutError as exc:
        _say(f"[runner] timed out: {exc}")
        return 5
    except Exception as exc:  # noqa: BLE001
        _say(f"[runner] login failed: {exc!r}")
        return 6

    store.save(VENDOR, result.cookies)
    if result.storage_state:
        store.save_storage_state(VENDOR, result.storage_state)

    _say(
        f"[runner] SUCCESS — {len(result.cookies)} cookies saved to {store.path(VENDOR)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
