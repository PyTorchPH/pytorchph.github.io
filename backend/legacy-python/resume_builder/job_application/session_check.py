"""Session-first authentication gate for job-application planning."""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from resume_builder.job_finder.access_guard import AccessGuard, AccessState
from resume_builder.llm.base import LLMProvider
from resume_builder.sources.social.auth import SessionStore, _default_session_dir

from .models import DynamicApplicationPlan
from .website_planner import ApplicationWebsitePlanner, build_application_dom_inventory


class JobSessionState(str, Enum):
    SIGNED_IN = "signed_in"
    SIGNED_OUT = "signed_out"
    UNKNOWN = "unknown"
    VERIFICATION_REQUIRED = "verification_required"
    RATE_LIMITED = "rate_limited"
    BLOCKED = "blocked"


class SessionDecision(BaseModel):
    site_key: str
    state: JobSessionState
    should_continue: bool = False
    method: str
    confidence: float = 0.0
    evidence: list[str] = Field(default_factory=list)
    human_handoff: bool = False


class SessionLogEntry(SessionDecision):
    checked_at: str
    url: str


class AIAuthAssessment(BaseModel):
    state: JobSessionState
    confidence: float = 0.0
    evidence: list[str] = Field(default_factory=list)


class ApplicationPlanningResult(BaseModel):
    session: SessionDecision
    plan: DynamicApplicationPlan | None = None


_AUTH_SYSTEM = """ROLE: authentication-state classifier for a job application website.
OUTPUT: strict JSON only. Decide signed_in, signed_out, unknown, verification_required,
rate_limited, or blocked from NON-SECRET session metadata and rendered DOM inventory.
Use visible account/avatar/logout/application-dashboard evidence for signed_in. Login/sign-up forms,
create-account walls, and sign-in-to-apply prompts mean signed_out. Ambiguous cookies alone do not
prove authentication. CAPTCHA/Cloudflare/verification/403/429 => stop and human handoff.
Never request credentials, cookie values, bypasses, or automatic sign-up.
"""

_SIGNED_IN = (
    re.compile(r"\blog\s*out\b", re.I),
    re.compile(r"\bsign\s*out\b", re.I),
    re.compile(r"\bmy applications?\b", re.I),
    re.compile(r"\bapplication dashboard\b", re.I),
    re.compile(r"aria-label=[\"'][^\"']*(?:account|profile|avatar)", re.I),
)
_SIGNED_OUT = (
    re.compile(r"\bsign\s*in\b", re.I),
    re.compile(r"\bsign\s*in\s+to\s+apply\b", re.I),
    re.compile(r"\blog\s*in\s+to\s+apply\b", re.I),
    re.compile(r"\bcreate (?:an )?account\b", re.I),
    re.compile(r"\bsign\s*up\s+to\s+apply\b", re.I),
    re.compile(r"type=[\"']password[\"']", re.I),
)


def _safe_site_key(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "-", value.strip().lower()).strip("-") or "job-site"


class JobSessionLogStore:
    """Non-secret decision log; cookie values are never written here."""

    def __init__(self, base_dir: Path | None = None) -> None:
        self._dir = base_dir or _default_session_dir()
        self._dir.mkdir(parents=True, exist_ok=True)

    def path(self, site_key: str) -> Path:
        return self._dir / f"job-{_safe_site_key(site_key)}.session_log.json"

    def load(self, site_key: str) -> list[SessionLogEntry]:
        path = self.path(site_key)
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            return [SessionLogEntry.model_validate(item) for item in payload]
        except (OSError, json.JSONDecodeError, ValueError):
            return []

    def latest(self, site_key: str) -> SessionLogEntry | None:
        entries = self.load(site_key)
        return entries[-1] if entries else None

    def append(self, entry: SessionLogEntry) -> None:
        path = self.path(entry.site_key)
        entries = [item.model_dump(mode="json") for item in self.load(entry.site_key)[-49:]]
        entries.append(entry.model_dump(mode="json"))
        path.write_text(json.dumps(entries, indent=2), encoding="utf-8")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


class SessionFirstAuthChecker:
    def __init__(
        self,
        *,
        session_store: SessionStore | None = None,
        log_store: JobSessionLogStore | None = None,
        llm: LLMProvider | None = None,
        log_ttl_seconds: float = 12 * 60 * 60,
    ) -> None:
        self.session_store = session_store or SessionStore()
        self.log_store = log_store or JobSessionLogStore()
        self.llm = llm
        self.log_ttl_seconds = log_ttl_seconds
        self.access_guard = AccessGuard()

    def check(
        self,
        *,
        site_key: str,
        url: str,
        html: str,
        status_code: int | None = 200,
        now: float | None = None,
    ) -> SessionDecision:
        current_time = time.time() if now is None else now
        access = self.access_guard.classify(url=url, html=html, status_code=status_code)
        if access.state != AccessState.OK:
            state = {
                AccessState.SIGNED_OUT: JobSessionState.SIGNED_OUT,
                AccessState.VERIFICATION_REQUIRED: JobSessionState.VERIFICATION_REQUIRED,
                AccessState.RATE_LIMITED: JobSessionState.RATE_LIMITED,
                AccessState.BLOCKED: JobSessionState.BLOCKED,
                AccessState.EMPTY: JobSessionState.UNKNOWN,
            }.get(access.state, JobSessionState.UNKNOWN)
            return self._record(
                site_key, url, state, "deterministic_access_gate", 1.0, list(access.evidence), False
            )

        visible = AccessGuard._visible_text_hint(html)
        signed_in_evidence = [pattern.pattern for pattern in _SIGNED_IN if pattern.search(visible)]
        if signed_in_evidence:
            return self._record(
                site_key, url, JobSessionState.SIGNED_IN, "deterministic_dom", 0.98,
                signed_in_evidence, True,
            )
        signed_out_evidence = [pattern.pattern for pattern in _SIGNED_OUT if pattern.search(visible)]
        if signed_out_evidence:
            return self._record(
                site_key, url, JobSessionState.SIGNED_OUT, "deterministic_dom", 1.0,
                signed_out_evidence, False,
            )

        session_meta = self._session_metadata(site_key, url, current_time)
        latest = self.log_store.latest(site_key)
        if latest and latest.state == JobSessionState.SIGNED_IN and session_meta["usable_cookie_count"]:
            checked = datetime.fromisoformat(latest.checked_at.replace("Z", "+00:00")).timestamp()
            if current_time - checked <= self.log_ttl_seconds:
                return self._record(
                    site_key, url, JobSessionState.SIGNED_IN, "deterministic_session_log", 0.95,
                    ["recent_signed_in_log", *session_meta["evidence"]], True,
                )

        if self.llm is not None:
            inventory = build_application_dom_inventory(html, url)
            assessment = self.llm.structured(
                "URL: " + url + "\nSESSION METADATA: " + json.dumps(session_meta) +
                "\nVISIBLE TEXT: " + visible[:2000] + "\nDOM INVENTORY:\n" + inventory[:12000],
                schema=AIAuthAssessment,
                system=_AUTH_SYSTEM,
                max_tokens=1024,
            )
            return self._record(
                site_key, url, assessment.state, "ai_fallback", assessment.confidence,
                assessment.evidence, assessment.state == JobSessionState.SIGNED_IN,
            )

        return self._record(
            site_key, url, JobSessionState.UNKNOWN, "deterministic_inconclusive", 0.0,
            session_meta["evidence"], False,
        )

    def _session_metadata(self, site_key: str, url: str, now: float) -> dict:
        host = (urlsplit(url).hostname or "").lower()
        state = self.session_store.load_storage_state(site_key) or {}
        cookies = list(state.get("cookies") or [])
        legacy_count = len(self.session_store.load(site_key))
        matching = []
        for cookie in cookies:
            domain = str(cookie.get("domain") or "").lstrip(".").lower()
            expires = float(cookie.get("expires") or -1)
            if domain and (host == domain or host.endswith("." + domain)) and (
                expires <= 0 or expires > now
            ):
                matching.append(cookie)
        usable_count = len(matching) + legacy_count
        evidence = []
        if state:
            evidence.append("stored_playwright_state")
        if usable_count:
            evidence.append(f"usable_cookie_count={usable_count}")
        return {
            "has_storage_state": bool(state),
            "usable_cookie_count": usable_count,
            "matching_cookie_domains": sorted(
                {str(cookie.get("domain") or "").lstrip(".") for cookie in matching}
            ),
            "evidence": evidence,
        }

    def _record(
        self,
        site_key: str,
        url: str,
        state: JobSessionState,
        method: str,
        confidence: float,
        evidence: list[str],
        should_continue: bool,
    ) -> SessionDecision:
        decision = SessionDecision(
            site_key=site_key,
            state=state,
            should_continue=should_continue,
            method=method,
            confidence=confidence,
            evidence=evidence,
            human_handoff=not should_continue,
        )
        self.log_store.append(
            SessionLogEntry(
                **decision.model_dump(),
                checked_at=datetime.now(timezone.utc).isoformat(),
                url=url,
            )
        )
        return decision


class SessionFirstApplicationPipeline:
    """Authenticate first; invoke the dynamic planner only when the gate permits it."""

    def __init__(self, checker: SessionFirstAuthChecker, planner: ApplicationWebsitePlanner) -> None:
        self.checker = checker
        self.planner = planner

    def run(
        self,
        *,
        site_key: str,
        pages: list[tuple[str, str]],
        status_code: int | None = 200,
        objective: str = "fill application draft",
    ) -> ApplicationPlanningResult:
        if not pages:
            raise ValueError("at least one rendered page is required")
        url, html = pages[0]
        session = self.checker.check(
            site_key=site_key, url=url, html=html, status_code=status_code
        )
        if not session.should_continue:
            return ApplicationPlanningResult(session=session)
        return ApplicationPlanningResult(
            session=session,
            plan=self.planner.plan(pages, objective=objective),
        )
