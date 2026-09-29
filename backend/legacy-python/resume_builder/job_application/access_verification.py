"""Deterministic access checks and a non-secret human-verification queue."""

from __future__ import annotations

import hashlib
import json
import re
from threading import RLock
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, model_validator

from .privacy import redact
from .shared.access_gate import (
    AccessGateResult,
    AccessGateState,
    check_access_gate,
    sanitize_application_url,
)

__all__ = [
    "AccessGateResult",
    "AccessGateState",
    "HumanVerificationQueue",
    "InterventionAction",
    "VerificationQueueEntry",
    "VerificationQueueGroup",
    "VerificationQueueState",
    "check_access_gate",
    "sanitize_application_url",
]

_QUEUE_LOCK = RLock()
_OPAQUE_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,200}$")


class VerificationQueueState(str, Enum):
    PENDING = "pending"
    RESOLVED = "resolved"


class VerificationQueueGroup(str, Enum):
    ACCESS_VERIFICATION = "access_verification"
    HUMAN_INTERVENTION = "human_intervention"


class InterventionAction(str, Enum):
    CAPTCHA = "captcha"
    HUMAN_VERIFICATION = "human_verification"
    UNKNOWN_QUESTION = "unknown_question"
    SIGN_IN = "sign_in"
    RESUME_UPLOAD = "resume_upload"
    RESUME_CONTINUE = "resume_continue"
    LAYOUT_REVIEW = "layout_review"
    EXTERNAL_APPLICATION = "external_application"
    OTHER = "other"


class VerificationQueueEntry(BaseModel):
    id: str
    application_reference: str
    domain: str
    url: str
    reason: str
    status: VerificationQueueState
    created_at: str
    updated_at: str
    occurrences: int = 1
    browser_target_id: str = ""
    group: VerificationQueueGroup = VerificationQueueGroup.ACCESS_VERIFICATION
    action: InterventionAction = InterventionAction.OTHER
    question_labels: list[str] = Field(default_factory=list)
    task_id: str = ""
    company: str = ""
    job_title: str = ""
    goal_id: str = ""
    resume_file: str = ""
    question_fingerprint: str = ""
    question_approved_at: str = ""
    question_approval_consumed_at: str = ""
    approval_granted_at: str = ""
    approval_consumed_at: str = ""
    layout_fingerprint: str = ""
    artifact_path: str = ""

    @model_validator(mode="before")
    @classmethod
    def classify_legacy_entry(cls, value):
        if not isinstance(value, dict) or value.get("action"):
            return value
        payload = dict(value)
        payload["action"] = _action_for_reason(str(payload.get("reason", ""))).value
        return payload


def _action_for_reason(reason: str) -> InterventionAction:
    normalized = reason.casefold().strip()
    if "captcha" in normalized:
        return InterventionAction.CAPTCHA
    if normalized in {"verification_required", "human_verification"}:
        return InterventionAction.HUMAN_VERIFICATION
    if normalized in {"signed_out", "sign_in"}:
        return InterventionAction.SIGN_IN
    if normalized in {"resume_upload", "resume_upload_approval"}:
        return InterventionAction.RESUME_UPLOAD
    if normalized in {"resume_continue", "resume_continue_approval"}:
        return InterventionAction.RESUME_CONTINUE
    if normalized in {"layout_review", "unknown_layout", "unknown_module"}:
        return InterventionAction.LAYOUT_REVIEW
    if normalized in {"unknown_question", "unanswered_question"}:
        return InterventionAction.UNKNOWN_QUESTION
    if normalized == "apply_on_company_site":
        return InterventionAction.EXTERNAL_APPLICATION
    return InterventionAction.OTHER


def _safe_application_reference(application_reference: str, safe_url: str) -> str:
    reference = application_reference.strip()
    parts = urlsplit(reference)
    if parts.scheme and parts.netloc:
        reference = sanitize_application_url(reference)
    return redact(reference, limit=200) or safe_url


def _safe_opaque_id(value: str, *, field: str) -> str:
    """Validate internal identifiers without passing them through PII redaction."""
    clean = (value or "").strip()
    if clean and not _OPAQUE_ID.fullmatch(clean):
        raise ValueError(f"invalid {field}")
    return clean


class HumanVerificationQueue:
    """JSON-backed queue containing no cookies, credentials, or URL query values."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def enqueue(
        self,
        *,
        application_reference: str,
        url: str,
        result: AccessGateResult,
        browser_target_id: str = "",
        group: VerificationQueueGroup = VerificationQueueGroup.ACCESS_VERIFICATION,
        task_id: str = "",
        company: str = "",
        job_title: str = "",
        goal_id: str = "",
        resume_file: str = "",
        layout_fingerprint: str = "",
        artifact_path: str = "",
    ) -> VerificationQueueEntry:
        if not result.blocked:
            raise ValueError("only human-required access results may be queued")
        return self.enqueue_handoff(
            application_reference=application_reference,
            url=url,
            reason=result.reason,
            browser_target_id=browser_target_id,
            group=group,
            task_id=task_id,
            company=company,
            job_title=job_title,
            goal_id=goal_id,
            resume_file=resume_file,
            layout_fingerprint=layout_fingerprint,
            artifact_path=artifact_path,
        )

    def enqueue_handoff(
        self,
        *,
        application_reference: str,
        url: str,
        reason: str,
        browser_target_id: str = "",
        group: VerificationQueueGroup = VerificationQueueGroup.HUMAN_INTERVENTION,
        action: InterventionAction | None = None,
        question_labels: list[str] | None = None,
        task_id: str = "",
        company: str = "",
        job_title: str = "",
        goal_id: str = "",
        resume_file: str = "",
        layout_fingerprint: str = "",
        artifact_path: str = "",
    ) -> VerificationQueueEntry:
        """Queue a non-access human handoff without pretending it is an access blocker."""
        with _QUEUE_LOCK:
            safe_url = sanitize_application_url(url)
            domain = (urlsplit(safe_url).hostname or "").lower()
            reference = _safe_application_reference(application_reference, safe_url)
            resolved_action = action or _action_for_reason(reason)
            entry_id = self._entry_id(domain, reference, resolved_action)
            payload = self._load()
            existing = payload.get(entry_id)
            legacy_id = self._legacy_entry_id(domain, reference)
            legacy = payload.get(legacy_id)
            if (
                existing is None
                and legacy is not None
                and _action_for_reason(str(legacy.get("reason", ""))) == resolved_action
            ):
                entry_id = legacy_id
                existing = legacy
            now = datetime.now(timezone.utc).isoformat()
            entry = VerificationQueueEntry(
                id=entry_id,
                application_reference=reference,
                domain=domain,
                url=safe_url,
                reason=redact(reason, limit=80),
                status=VerificationQueueState.PENDING,
                created_at=existing.get("created_at", now) if existing else now,
                updated_at=now,
                occurrences=int(existing.get("occurrences", 1)) + 1 if existing else 1,
                browser_target_id=browser_target_id
                or (str(existing.get("browser_target_id", "")) if existing else ""),
                group=group,
                action=resolved_action,
                question_labels=[
                    redact(label, limit=240)
                    for label in (question_labels or [])[:12]
                    if redact(label, limit=240)
                ],
                task_id=_safe_opaque_id(task_id, field="task_id")
                or (str(existing.get("task_id", "")) if existing else ""),
                company=redact(company, limit=160)
                or (str(existing.get("company", "")) if existing else ""),
                job_title=redact(job_title, limit=200)
                or (str(existing.get("job_title", "")) if existing else ""),
                goal_id=_safe_opaque_id(goal_id, field="goal_id")
                or (str(existing.get("goal_id", "")) if existing else ""),
                resume_file=(
                    Path(resume_file).name
                    if resume_file
                    else (str(existing.get("resume_file", "")) if existing else "")
                ),
                layout_fingerprint=redact(layout_fingerprint, limit=80),
                artifact_path=(
                    str(Path(artifact_path))[:240]
                    if artifact_path
                    else (str(existing.get("artifact_path", "")) if existing else "")
                ),
            )
            payload[entry_id] = entry.model_dump(mode="json")
            self._save(payload)
        return entry

    def resolve_if_clear(
        self,
        *,
        application_reference: str,
        url: str,
        result: AccessGateResult,
    ) -> VerificationQueueEntry | None:
        if result.blocked:
            return None
        with _QUEUE_LOCK:
            safe_url = sanitize_application_url(url)
            domain = (urlsplit(safe_url).hostname or "").lower()
            reference = _safe_application_reference(application_reference, safe_url)
            payload = self._load()
            entry_id = next(
                (
                    key
                    for key, value in payload.items()
                    if value.get("status") == VerificationQueueState.PENDING.value
                    and str(value.get("domain", "")) == domain
                    and str(value.get("application_reference", "")) == reference
                    and _action_for_reason(str(value.get("reason", "")))
                    in {
                        InterventionAction.CAPTCHA,
                        InterventionAction.HUMAN_VERIFICATION,
                        InterventionAction.SIGN_IN,
                    }
                ),
                "",
            )
            existing = payload.get(entry_id)
            if not existing:
                return None
            existing["status"] = VerificationQueueState.RESOLVED.value
            existing["updated_at"] = datetime.now(timezone.utc).isoformat()
            payload[entry_id] = existing
            self._save(payload)
        return VerificationQueueEntry.model_validate(existing)

    def pending(self) -> list[VerificationQueueEntry]:
        with _QUEUE_LOCK:
            return sorted(
                (
                    VerificationQueueEntry.model_validate(value)
                    for value in self._load().values()
                    if value.get("status") == VerificationQueueState.PENDING.value
                ),
                key=lambda item: item.updated_at,
            )

    def get(self, entry_id: str) -> VerificationQueueEntry | None:
        """Return one queue entry regardless of whether it is pending or resolved."""
        with _QUEUE_LOCK:
            existing = self._load().get(entry_id)
        return VerificationQueueEntry.model_validate(existing) if existing else None

    @staticmethod
    def _entry_id(
        domain: str,
        application_reference: str,
        action: InterventionAction = InterventionAction.OTHER,
    ) -> str:
        value = f"{domain}\n{application_reference}\n{action.value}".encode()
        return hashlib.sha256(value).hexdigest()[:20]

    @staticmethod
    def _legacy_entry_id(domain: str, application_reference: str) -> str:
        value = f"{domain}\n{application_reference}".encode()
        return hashlib.sha256(value).hexdigest()[:20]

    def resolve(self, entry_id: str) -> VerificationQueueEntry | None:
        """Resolve one exact intervention after its page state has been proven clear."""
        with _QUEUE_LOCK:
            payload = self._load()
            existing = payload.get(entry_id)
            if not existing:
                return None
            existing["status"] = VerificationQueueState.RESOLVED.value
            existing["updated_at"] = datetime.now(timezone.utc).isoformat()
            payload[entry_id] = existing
            self._save(payload)
        return VerificationQueueEntry.model_validate(existing)

    def reattach_target(
        self,
        entry_id: str,
        *,
        browser_target_id: str,
        goal_id: str = "",
    ) -> VerificationQueueEntry:
        """Attach a pending handoff to a newly opened browser tab after browser restart."""
        target_id = _safe_opaque_id(browser_target_id, field="browser_target_id")
        if not target_id:
            raise ValueError("browser_target_id is required")
        clean_goal_id = _safe_opaque_id(goal_id, field="goal_id")
        with _QUEUE_LOCK:
            payload = self._load()
            existing = payload.get(entry_id)
            if not existing:
                raise KeyError(entry_id)
            entry = VerificationQueueEntry.model_validate(existing)
            if entry.status != VerificationQueueState.PENDING:
                raise ValueError("only pending interventions can be reattached")
            existing["browser_target_id"] = target_id
            if clean_goal_id:
                existing["goal_id"] = clean_goal_id
            existing["updated_at"] = datetime.now(timezone.utc).isoformat()
            payload[entry_id] = existing
            self._save(payload)
        return VerificationQueueEntry.model_validate(existing)

    def resolve_matching(
        self,
        *,
        application_reference: str,
        action: InterventionAction,
    ) -> list[VerificationQueueEntry]:
        """Resolve pending entries for one application and one exact action kind."""
        reference = _safe_application_reference(application_reference, "")
        resolved: list[VerificationQueueEntry] = []
        with _QUEUE_LOCK:
            payload = self._load()
            now = datetime.now(timezone.utc).isoformat()
            for entry_id, existing in payload.items():
                entry = VerificationQueueEntry.model_validate(existing)
                if (
                    entry.status == VerificationQueueState.PENDING
                    and entry.application_reference == reference
                    and entry.action == action
                ):
                    existing["status"] = VerificationQueueState.RESOLVED.value
                    existing["updated_at"] = now
                    payload[entry_id] = existing
                    resolved.append(VerificationQueueEntry.model_validate(existing))
            if resolved:
                self._save(payload)
        return resolved

    def approve_question(
        self,
        entry_id: str,
        *,
        question_fingerprint: str,
    ) -> VerificationQueueEntry:
        """Resolve one exact question handoff with a non-secret, one-use approval marker."""
        fingerprint = question_fingerprint.strip().lower()
        if len(fingerprint) != 40 or any(
            character not in "0123456789abcdef" for character in fingerprint
        ):
            raise ValueError("question fingerprint must be a SHA-1 hex digest")
        with _QUEUE_LOCK:
            payload = self._load()
            existing = payload.get(entry_id)
            if not existing:
                raise KeyError(entry_id)
            entry = VerificationQueueEntry.model_validate(existing)
            if entry.action != InterventionAction.UNKNOWN_QUESTION:
                raise ValueError("only unknown-question handoffs can be approved")
            now = datetime.now(timezone.utc).isoformat()
            existing["status"] = VerificationQueueState.RESOLVED.value
            existing["updated_at"] = now
            existing["question_fingerprint"] = fingerprint
            existing["question_approved_at"] = now
            existing["question_approval_consumed_at"] = ""
            payload[entry_id] = existing
            self._save(payload)
        return VerificationQueueEntry.model_validate(existing)

    def approve_action(self, entry_id: str) -> VerificationQueueEntry:
        """Grant one-use approval for an exact resume gate."""
        with _QUEUE_LOCK:
            payload = self._load()
            existing = payload.get(entry_id)
            if not existing:
                raise KeyError(entry_id)
            entry = VerificationQueueEntry.model_validate(existing)
            if entry.action not in {
                InterventionAction.RESUME_UPLOAD,
                InterventionAction.RESUME_CONTINUE,
            }:
                raise ValueError("only resume gates use this approval")
            now = datetime.now(timezone.utc).isoformat()
            existing["status"] = VerificationQueueState.RESOLVED.value
            existing["updated_at"] = now
            existing["approval_granted_at"] = now
            existing["approval_consumed_at"] = ""
            payload[entry_id] = existing
            self._save(payload)
        return VerificationQueueEntry.model_validate(existing)

    def approved_action(
        self,
        *,
        application_reference: str,
        action: InterventionAction,
    ) -> VerificationQueueEntry | None:
        reference = _safe_application_reference(application_reference, "")
        with _QUEUE_LOCK:
            entries = [
                VerificationQueueEntry.model_validate(value) for value in self._load().values()
            ]
        return next(
            (
                entry
                for entry in sorted(entries, key=lambda item: item.updated_at, reverse=True)
                if entry.action == action
                and entry.status == VerificationQueueState.RESOLVED
                and entry.application_reference == reference
                and entry.approval_granted_at
                and not entry.approval_consumed_at
            ),
            None,
        )

    def consume_action(self, entry_id: str) -> VerificationQueueEntry | None:
        with _QUEUE_LOCK:
            payload = self._load()
            existing = payload.get(entry_id)
            if not existing:
                return None
            entry = VerificationQueueEntry.model_validate(existing)
            if not entry.approval_granted_at or entry.approval_consumed_at:
                return entry
            now = datetime.now(timezone.utc).isoformat()
            existing["updated_at"] = now
            existing["approval_consumed_at"] = now
            payload[entry_id] = existing
            self._save(payload)
        return VerificationQueueEntry.model_validate(existing)

    def approved_question(
        self,
        *,
        application_reference: str,
        browser_target_id: str,
        question_fingerprint: str,
    ) -> VerificationQueueEntry | None:
        """Return an unconsumed approval for this exact application, tab, and question set."""
        reference = _safe_application_reference(application_reference, "")
        with _QUEUE_LOCK:
            entries = [
                VerificationQueueEntry.model_validate(value) for value in self._load().values()
            ]
        return next(
            (
                entry
                for entry in sorted(entries, key=lambda item: item.updated_at, reverse=True)
                if entry.action == InterventionAction.UNKNOWN_QUESTION
                and entry.status == VerificationQueueState.RESOLVED
                and entry.application_reference == reference
                and entry.browser_target_id == browser_target_id
                and entry.question_fingerprint == question_fingerprint
                and not entry.question_approval_consumed_at
            ),
            None,
        )

    def consume_question_approval(self, entry_id: str) -> VerificationQueueEntry | None:
        """Consume a question approval only after its exact page successfully advances."""
        with _QUEUE_LOCK:
            payload = self._load()
            existing = payload.get(entry_id)
            if not existing:
                return None
            entry = VerificationQueueEntry.model_validate(existing)
            if not entry.question_approved_at or entry.question_approval_consumed_at:
                return entry
            now = datetime.now(timezone.utc).isoformat()
            existing["updated_at"] = now
            existing["question_approval_consumed_at"] = now
            payload[entry_id] = existing
            self._save(payload)
        return VerificationQueueEntry.model_validate(existing)

    def _load(self) -> dict[str, dict]:
        if not self.path.exists():
            return {}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _save(self, payload: dict[str, dict]) -> None:
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        temporary.replace(self.path)
