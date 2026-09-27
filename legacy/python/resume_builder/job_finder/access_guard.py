from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from enum import Enum
from urllib.parse import urlsplit


class AccessState(str, Enum):
    """Read-only access classification before job extraction runs."""

    OK = "ok"
    SIGNED_OUT = "signed_out"
    VERIFICATION_REQUIRED = "verification_required"
    RATE_LIMITED = "rate_limited"
    BLOCKED = "blocked"
    EMPTY = "empty"


@dataclass(frozen=True)
class AccessDecision:
    state: AccessState
    should_continue: bool
    reason: str
    evidence: tuple[str, ...] = ()
    retry_after_seconds: float | None = None


@dataclass(frozen=True)
class AccessPolicy:
    """Compliant first-line access policy.

    This borrows the safe parts of the rdtii-autoextract layered retrieval design:
    classify access before extraction, throttle per domain, use bounded retries,
    and stop on verification. It deliberately does not rotate identities or
    bypass CAPTCHA/Cloudflare/login walls.
    """

    min_domain_gap_seconds: float = 12.0
    retry_backoff_seconds: tuple[float, ...] = (15.0, 45.0, 120.0)
    max_retries: int = 2


@dataclass
class DomainThrottle:
    policy: AccessPolicy = field(default_factory=AccessPolicy)
    _last_access_by_domain: dict[str, float] = field(default_factory=dict)

    def wait_seconds(self, url: str, *, now: float | None = None) -> float:
        domain = urlsplit(url).netloc.lower()
        if not domain:
            return 0.0
        current = time.monotonic() if now is None else now
        last = self._last_access_by_domain.get(domain)
        if last is None:
            return 0.0
        return max(0.0, self.policy.min_domain_gap_seconds - (current - last))

    def mark_access(self, url: str, *, now: float | None = None) -> None:
        domain = urlsplit(url).netloc.lower()
        if domain:
            self._last_access_by_domain[domain] = time.monotonic() if now is None else now


class AccessGuard:
    """Classify public job-site pages before parser/extractor logic runs."""

    _VERIFICATION_PATTERNS = (
        re.compile(r"additional verification required", re.IGNORECASE),
        re.compile(r"just a moment", re.IGNORECASE),
        re.compile(r"cloudflare", re.IGNORECASE),
        re.compile(r"captcha", re.IGNORECASE),
        re.compile(r"verify (?:that )?you are (?:a )?human", re.IGNORECASE),
        re.compile(r"verifying (?:your browser|your request|you are human)", re.IGNORECASE),
        re.compile(r"ray id", re.IGNORECASE),
    )
    _RATE_LIMIT_PATTERNS = (
        re.compile(r"too many requests", re.IGNORECASE),
        re.compile(r"rate limit", re.IGNORECASE),
        re.compile(r"try again later", re.IGNORECASE),
    )
    _SIGNED_OUT_PATTERNS = (
        re.compile(r"sign in to find jobs", re.IGNORECASE),
        re.compile(r"continue with google", re.IGNORECASE),
        re.compile(r"continue with email", re.IGNORECASE),
        re.compile(r"login required", re.IGNORECASE),
    )
    _BLOCKED_PATTERNS = (
        re.compile(r"access denied", re.IGNORECASE),
        re.compile(r"request blocked", re.IGNORECASE),
        re.compile(r"forbidden", re.IGNORECASE),
    )

    def __init__(
        self,
        policy: AccessPolicy | None = None,
        throttle: DomainThrottle | None = None,
    ) -> None:
        self.policy = policy or AccessPolicy()
        self.throttle = throttle or DomainThrottle(self.policy)

    def classify(
        self,
        *,
        url: str,
        html: str,
        status_code: int | None = None,
        attempt: int = 0,
        now: float | None = None,
    ) -> AccessDecision:
        throttle_wait = self.throttle.wait_seconds(url, now=now)
        if throttle_wait > 0:
            return AccessDecision(
                state=AccessState.RATE_LIMITED,
                should_continue=False,
                reason="domain throttle active before next request",
                evidence=("domain_throttle",),
                retry_after_seconds=throttle_wait,
            )

        if status_code in {401, 403}:
            return self._stop(AccessState.BLOCKED, f"http_{status_code}", ("http_status",))
        if status_code == 429:
            return self._retry_or_stop(attempt, "http_429", ("http_status",))
        if not html.strip():
            return self._retry_or_stop(attempt, "empty_html", ("empty_html",), empty=True)

        text = self._visible_text_hint(html)
        for state, patterns, reason in (
            (
                AccessState.VERIFICATION_REQUIRED,
                self._VERIFICATION_PATTERNS,
                "verification required; human handoff",
            ),
            (AccessState.RATE_LIMITED, self._RATE_LIMIT_PATTERNS, "rate limited"),
            (AccessState.BLOCKED, self._BLOCKED_PATTERNS, "blocked by site"),
            (AccessState.SIGNED_OUT, self._SIGNED_OUT_PATTERNS, "signed out or sign-in modal"),
        ):
            evidence = tuple(pattern.pattern for pattern in patterns if pattern.search(text))
            if evidence:
                if state == AccessState.RATE_LIMITED:
                    return self._retry_or_stop(attempt, reason, evidence)
                return AccessDecision(
                    state=state,
                    should_continue=False,
                    reason=reason,
                    evidence=evidence,
                )

        return AccessDecision(
            state=AccessState.OK,
            should_continue=True,
            reason="page can be analyzed",
            evidence=(),
        )

    def mark_access(self, url: str, *, now: float | None = None) -> None:
        self.throttle.mark_access(url, now=now)

    def next_backoff(self, attempt: int) -> float:
        if not self.policy.retry_backoff_seconds:
            return 0.0
        index = min(max(attempt, 0), len(self.policy.retry_backoff_seconds) - 1)
        return self.policy.retry_backoff_seconds[index]

    @staticmethod
    def _visible_text_hint(html: str) -> str:
        text = re.sub(r"<(script|style|noscript|template)\b.*?</\1>", " ", html, flags=re.I | re.S)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text)
        # A passive legal disclosure is present on ordinary application forms and is not a
        # challenge. Active CAPTCHA headings/instructions remain available to the patterns above.
        text = re.sub(
            r"this site is protected by recaptcha.*?terms of service apply\.?",
            " ",
            text,
            flags=re.I | re.S,
        )
        return text

    @staticmethod
    def _stop(state: AccessState, reason: str, evidence: tuple[str, ...]) -> AccessDecision:
        return AccessDecision(state=state, should_continue=False, reason=reason, evidence=evidence)

    def _retry_or_stop(
        self,
        attempt: int,
        reason: str,
        evidence: tuple[str, ...],
        *,
        empty: bool = False,
    ) -> AccessDecision:
        if attempt < self.policy.max_retries:
            return AccessDecision(
                state=AccessState.EMPTY if empty else AccessState.RATE_LIMITED,
                should_continue=False,
                reason=f"{reason}; retry with bounded backoff",
                evidence=evidence,
                retry_after_seconds=self.next_backoff(attempt),
            )
        return AccessDecision(
            state=AccessState.EMPTY if empty else AccessState.RATE_LIMITED,
            should_continue=False,
            reason=f"{reason}; retry budget exhausted, human handoff",
            evidence=evidence,
        )
