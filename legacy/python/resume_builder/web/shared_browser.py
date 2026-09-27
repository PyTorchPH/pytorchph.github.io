"""Own one visible Brave/CDP process for the local job-finder control center."""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path
from threading import RLock
from urllib.parse import quote, urlsplit

import requests

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_PROFILE_DIR = REPO_ROOT / "var" / "sessions" / "browsers" / "career-lens"
_LOCK = RLock()
_PROCESS: subprocess.Popen | None = None


def cdp_url() -> str:
    return os.environ.get(
        "RESUME_BUILD_PLAYWRIGHT_CDP_URL",
        "http://127.0.0.1:9222",
    ).rstrip("/")


def _debugging_port(url: str) -> int:
    parsed = urlsplit(url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("the shared browser CDP URL must use a loopback HTTP address")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("the shared browser CDP URL must not contain a path, query, or fragment")
    return parsed.port or 80


def _browser_executable() -> str:
    configured = os.environ.get("JOB_FINDER_BROWSER_EXECUTABLE", "").strip()
    legacy_configured = os.environ.get("JOB_FINDER_CHROME_EXECUTABLE", "").strip()
    candidates = [
        configured,
        legacy_configured,
        shutil.which("brave-browser-stable") or "",
        shutil.which("brave-browser") or "",
        "/opt/brave.com/brave/brave",
        shutil.which("google-chrome-stable") or "",
        shutil.which("google-chrome") or "",
        shutil.which("chromium") or "",
        shutil.which("chromium-browser") or "",
        "/opt/google/chrome/chrome",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    raise RuntimeError(
        "Brave/Chrome is unavailable; set JOB_FINDER_BROWSER_EXECUTABLE to its executable"
    )


def is_ready(*, url: str | None = None) -> bool:
    try:
        response = requests.get(f"{url or cdp_url()}/json/version", timeout=1)
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError):
        return False
    return isinstance(payload, dict) and bool(payload.get("webSocketDebuggerUrl"))


def ensure_shared_browser(*, timeout: float = 10.0) -> dict[str, object]:
    """Start the single persistent visible Brave browser when its CDP endpoint is absent."""
    global _PROCESS

    url = cdp_url()
    port = _debugging_port(url)
    if is_ready(url=url):
        return {"cdp_url": url, "started": False, "pid": None}

    with _LOCK:
        if is_ready(url=url):
            return {"cdp_url": url, "started": False, "pid": None}
        if _PROCESS is None or _PROCESS.poll() is not None:
            profile = Path(
                os.environ.get("JOB_FINDER_CHROME_PROFILE", str(DEFAULT_PROFILE_DIR))
            ).expanduser()
            profile.mkdir(parents=True, exist_ok=True)
            _PROCESS = subprocess.Popen(
                [
                    _browser_executable(),
                    "--remote-debugging-address=127.0.0.1",
                    f"--remote-debugging-port={port}",
                    f"--user-data-dir={profile}",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "about:blank",
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        process = _PROCESS

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if is_ready(url=url):
            return {"cdp_url": url, "started": True, "pid": process.pid}
        if process.poll() is not None:
            raise RuntimeError(f"shared Chrome exited with code {process.returncode}")
        time.sleep(0.1)
    raise RuntimeError(f"shared Chrome did not expose CDP at {url} within {timeout:g}s")


def open_tab(url: str) -> dict[str, str]:
    """Open a URL as a tab in the shared browser's existing default context."""
    ensure_shared_browser()
    response = requests.put(f"{cdp_url()}/json/new?{quote(url, safe=':/')}", timeout=4)
    response.raise_for_status()
    payload = response.json()
    return {"target_id": str(payload.get("id", "")), "url": str(payload.get("url", url))}
