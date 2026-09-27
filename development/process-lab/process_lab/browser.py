from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from prefect.concurrency.sync import concurrency

from .contracts import BrowserJourneyResult


@contextmanager
def attached_page(cdp_url: str, trace_path: Path) -> Iterator[object]:
    """Attach to a normal loopback Chrome context; do not launch or disguise a browser."""
    from playwright.sync_api import sync_playwright

    trace_path.parent.mkdir(parents=True, exist_ok=True)
    with concurrency("pytorch-ph-browser-cdp", strict=True), sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(cdp_url)
        if not browser.contexts:
            browser.close()
            raise RuntimeError("The CDP browser has no default context.")
        context = browser.contexts[0]
        context.tracing.start(screenshots=True, snapshots=True, sources=False)
        page = context.new_page()
        try:
            yield page
        finally:
            page.close()
            context.tracing.stop(path=str(trace_path))
            browser.close()


def login_journey(
    *, cdp_url: str, member_url: str, email: str, password: str, trace_path: Path
) -> BrowserJourneyResult:
    if not email or not password:
        raise ValueError("PROCESS_LAB_EMAIL and PROCESS_LAB_PASSWORD are required.")
    with attached_page(cdp_url, trace_path) as page:
        page.goto(f"{member_url}/login", wait_until="domcontentloaded")
        page.get_by_placeholder("you@fit.edu.ph").fill(email)
        page.get_by_placeholder("Password").fill(password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        page.wait_for_url(lambda url: url.path in {"/dashboard", "/membership"}, timeout=20_000)
        final_url = page.url
        heading_visible = page.get_by_role("heading").first.is_visible()
        return BrowserJourneyResult(
            name="member-login",
            final_url=final_url,
            assertions={"protected_destination": True, "heading_visible": heading_visible},
            trace_path=str(trace_path),
        )


def registration_contract_journey(
    *, cdp_url: str, member_url: str, trace_path: Path
) -> BrowserJourneyResult:
    """Validate the real form contract without creating an account or submitting a write."""
    with attached_page(cdp_url, trace_path) as page:
        page.goto(f"{member_url}/register", wait_until="domcontentloaded")
        fields = {
            "full_name": page.get_by_placeholder("Full name").is_visible(),
            "username": page.get_by_placeholder("Leaderboard username").is_visible(),
            "school_email": page.get_by_placeholder("you@fit.edu.ph").is_visible(),
            "password": page.get_by_placeholder("Password", exact=True).is_visible(),
            "confirm": page.get_by_placeholder("Confirm password").is_visible(),
            "submit": page.get_by_role("button", name="Create account").is_visible(),
        }
        return BrowserJourneyResult(
            name="registration-contract",
            final_url=page.url,
            assertions=fields,
            trace_path=str(trace_path),
        )


def leaderboard_journey(*, cdp_url: str, member_url: str, trace_path: Path) -> BrowserJourneyResult:
    with attached_page(cdp_url, trace_path) as page:
        page.goto(f"{member_url}/leaderboards", wait_until="networkidle")
        response = page.evaluate(
            """async () => {
              const response = await fetch('/api/member/leaderboard?page=1&pageSize=25');
              return {status: response.status, body: await response.json()};
            }"""
        )
        body = response.get("body", {})
        serialized = json.dumps(body).lower()
        private_markers = ("email", "phone", "sourceurl", "evidenceid", "resume")
        assertions = {
            "api_ok": response.get("status") == 200,
            "entries_present": bool(body.get("entries")),
            "private_fields_absent": not any(marker in serialized for marker in private_markers),
            "leaderboard_heading": page.get_by_role("heading", name="Season rankings").is_visible(),
        }
        return BrowserJourneyResult(
            name="leaderboard",
            final_url=page.url,
            assertions=assertions,
            trace_path=str(trace_path),
        )
