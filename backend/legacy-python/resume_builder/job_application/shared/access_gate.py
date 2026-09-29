"""Website-agnostic access, authentication, and challenge classification."""

from __future__ import annotations

from enum import Enum
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel


class AccessGateState(str, Enum):
    CLEAR = "clear"
    HUMAN_REQUIRED = "human_required"


class AccessGateResult(BaseModel):
    state: AccessGateState
    reason: str = ""
    evidence: str = ""

    @property
    def blocked(self) -> bool:
        return self.state == AccessGateState.HUMAN_REQUIRED


def sanitize_application_url(url: str) -> str:
    """Remove query parameters and fragments that may contain session identifiers."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def check_access_gate(page: Any) -> AccessGateResult:
    """Classify visible access controls without solving or bypassing them."""
    recaptcha_frames = page.locator('iframe[src*="recaptcha"]')
    for index in range(recaptcha_frames.count()):
        iframe = recaptcha_frames.nth(index)
        if not iframe.is_visible():
            continue
        src = iframe.get_attribute("src") or ""
        if "/bframe" in src:
            return AccessGateResult(
                state=AccessGateState.HUMAN_REQUIRED,
                reason="captcha",
                evidence="visible reCAPTCHA challenge",
            )
        try:
            handle = iframe.element_handle()
            frame = handle.content_frame() if handle is not None else None
            anchor = frame.locator("#recaptcha-anchor") if frame is not None else None
            checked = (
                anchor is not None
                and anchor.count()
                and anchor.get_attribute("aria-checked") == "true"
            )
        except Exception:  # Browser/frame drift must fail closed.
            checked = False
        if checked:
            continue
        return AccessGateResult(
            state=AccessGateState.HUMAN_REQUIRED,
            reason="captcha",
            evidence="visible incomplete reCAPTCHA",
        )

    for selector, reason, evidence in (
        ('iframe[src*="hcaptcha"]', "captcha", "visible hCaptcha"),
        (
            'iframe[src*="challenges.cloudflare.com"]',
            "verification_required",
            "visible Cloudflare challenge frame",
        ),
        (
            ".cf-turnstile, #challenge-stage, #challenge-running, form#challenge-form",
            "verification_required",
            "visible Cloudflare challenge",
        ),
        (
            "[data-testid=challenge-form]",
            "verification_required",
            "visible verification challenge",
        ),
    ):
        locator = page.locator(selector)
        if any(locator.nth(index).is_visible() for index in range(locator.count())):
            return AccessGateResult(
                state=AccessGateState.HUMAN_REQUIRED,
                reason=reason,
                evidence=evidence,
            )

    body = page.locator("body").first
    text = body.inner_text().lower() if body.count() else ""
    for marker, reason in (
        ("verify you are human", "verification_required"),
        ("additional verification required", "verification_required"),
        ("performing security verification", "verification_required"),
        ("checking if the site connection is secure", "verification_required"),
        ("checking your browser before accessing", "verification_required"),
        ("enable javascript and cookies to continue", "verification_required"),
        ("cloudflare errors", "verification_required"),
        ("sign in to continue", "signed_out"),
        ("access denied", "blocked"),
        ("too many requests", "rate_limited"),
    ):
        if marker in text:
            return AccessGateResult(
                state=AccessGateState.HUMAN_REQUIRED,
                reason=reason,
                evidence=f"visible page marker: {marker}",
            )
    return AccessGateResult(state=AccessGateState.CLEAR)
