"""SQLite application history with an atomic recent-duplicate submission guard."""

from __future__ import annotations

import sqlite3
import unicodedata
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Protocol
from urllib.parse import parse_qs, urlsplit

from pydantic import BaseModel

from resume_builder.core.runtime_paths import var_path

from .ledger import LedgerState
from .privacy import redact

DEFAULT_SUBMISSION_HISTORY_PATH = var_path(
    "state", "job-applications", "submissions.sqlite3"
)


class SubmissionDecision(str, Enum):
    RESERVED = "reserved"
    RECENT_DUPLICATE = "recent_duplicate"
    UNRESOLVED_ATTEMPT = "unresolved_attempt"


class ConfirmationSource(str, Enum):
    BROWSER = "browser"
    MANUAL = "manual"
    EMAIL = "email"


class SubmissionConfirmation(BaseModel):
    """Provider-neutral proof that an application was submitted."""

    source: ConfirmationSource
    detail: str = ""
    observed_at: datetime | None = None


class SubmissionConfirmationProvider(Protocol):
    """Boundary implemented by manual, browser, or email confirmation sources."""

    def find_confirmation(
        self,
        *,
        company: str,
        job_title: str,
        submitted_after: datetime,
    ) -> SubmissionConfirmation | None: ...


class SubmissionReservation(BaseModel):
    decision: SubmissionDecision
    application_id: int | None = None
    matched_application_id: int | None = None
    matched_applied_at: str = ""

    @property
    def allowed(self) -> bool:
        return self.decision == SubmissionDecision.RESERVED


class ApplicationHistoryEntry(BaseModel):
    id: int
    company: str
    job_title: str
    state: LedgerState
    applied_at: str = ""
    updated_at: str
    confirmation: str = ""
    confirmation_source: ConfirmationSource | None = None
    source_domain: str = ""
    source_url: str = ""
    company_id: int | None = None
    job_posting_id: int | None = None


def normalize_exact_identity(value: str) -> str:
    """Normalize presentation differences while preserving exact word identity."""
    return unicodedata.normalize("NFKC", " ".join(value.split())).casefold()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _safe_source_url(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}{parts.path}" if parts.scheme else ""


def _provider_identity(url: str) -> tuple[str, str]:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if host == "indeed.com" or host.endswith(".indeed.com"):
        job_ids = parse_qs(parts.query).get("jk", [])
        if len(job_ids) == 1:
            job_id = job_ids[0].strip()
            if job_id and job_id.isalnum():
                return "indeed", job_id
    return "", ""


def _title_is_expanded_variant(first: str, second: str) -> bool:
    """Recognize an exact title expanded with Indeed's metadata suffix."""
    first_key = normalize_exact_identity(first)
    second_key = normalize_exact_identity(second)
    shorter, longer = sorted((first_key, second_key), key=len)
    return bool(shorter and longer.startswith(f"{shorter} | "))


class ApplicationSubmissionHistory:
    """Durable normalized SQL history for companies, postings, and submissions."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def reserve_submission(
        self,
        *,
        company: str,
        job_title: str,
        source_url: str = "",
        within_days: int = 30,
        now: datetime | None = None,
    ) -> SubmissionReservation:
        """Atomically query recent history and reserve an eligible submission."""
        if within_days < 1:
            raise ValueError("within_days must be at least 1")
        company_value, title_value = self._validated_identity(company, job_title)
        timestamp = (now or _utc_now()).astimezone(timezone.utc)
        timestamp_text = timestamp.isoformat()
        cutoff = (timestamp - timedelta(days=within_days)).isoformat()
        company_key = normalize_exact_identity(company_value)
        title_key = normalize_exact_identity(title_value)
        safe_url = _safe_source_url(source_url)
        domain = (urlsplit(safe_url).hostname or "").lower()
        provider, provider_job_id = _provider_identity(source_url)

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            company_id = self._ensure_company(
                connection,
                company_value,
                company_key,
                timestamp_text,
            )
            job_posting_id = self._ensure_job_posting(
                connection,
                company_id=company_id,
                job_title=title_value,
                title_key=title_key,
                provider=provider,
                provider_job_id=provider_job_id,
                source_url=safe_url,
                timestamp=timestamp_text,
            )
            recent = connection.execute(
                """
                SELECT id, applied_at
                FROM applications
                WHERE (
                    job_posting_id = ?
                    OR (company_key = ? AND job_title_key = ?)
                  )
                  AND state = ?
                  AND applied_at >= ?
                ORDER BY applied_at DESC
                LIMIT 1
                """,
                (
                    job_posting_id,
                    company_key,
                    title_key,
                    LedgerState.SUBMITTED.value,
                    cutoff,
                ),
            ).fetchone()
            if recent:
                connection.execute(
                    """
                    UPDATE applications
                    SET company_id = COALESCE(company_id, ?),
                        job_posting_id = COALESCE(job_posting_id, ?)
                    WHERE id = ?
                    """,
                    (company_id, job_posting_id, recent["id"]),
                )
                reservation = SubmissionReservation(
                    decision=SubmissionDecision.RECENT_DUPLICATE,
                    matched_application_id=recent["id"],
                    matched_applied_at=recent["applied_at"] or "",
                )
                self._insert_audit(
                    connection,
                    timestamp_text,
                    company_value,
                    title_value,
                    "eligibility_check",
                    reservation.decision.value,
                    f"confirmed submission found within {within_days} days",
                )
                return reservation

            unresolved = connection.execute(
                """
                SELECT id, updated_at
                FROM applications
                WHERE (
                    job_posting_id = ?
                    OR (company_key = ? AND job_title_key = ?)
                  )
                  AND state IN (?, ?)
                  AND updated_at >= ?
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (
                    job_posting_id,
                    company_key,
                    title_key,
                    LedgerState.SUBMITTING.value,
                    LedgerState.SUBMISSION_UNKNOWN.value,
                    cutoff,
                ),
            ).fetchone()
            if unresolved:
                reservation = SubmissionReservation(
                    decision=SubmissionDecision.UNRESOLVED_ATTEMPT,
                    matched_application_id=unresolved["id"],
                )
                self._insert_audit(
                    connection,
                    timestamp_text,
                    company_value,
                    title_value,
                    "eligibility_check",
                    reservation.decision.value,
                    "recent submission attempt has no confirmed outcome",
                )
                return reservation

            cursor = connection.execute(
                """
                INSERT INTO applications (
                    company, job_title, company_key, job_title_key, state,
                    applied_at, updated_at, confirmation, source_domain, source_url,
                    company_id, job_posting_id
                ) VALUES (?, ?, ?, ?, ?, NULL, ?, '', ?, ?, ?, ?)
                """,
                (
                    company_value,
                    title_value,
                    company_key,
                    title_key,
                    LedgerState.SUBMITTING.value,
                    timestamp_text,
                    domain,
                    safe_url,
                    company_id,
                    job_posting_id,
                ),
            )
            application_id = int(cursor.lastrowid)
            self._insert_audit(
                connection,
                timestamp_text,
                company_value,
                title_value,
                "eligibility_check",
                SubmissionDecision.RESERVED.value,
                f"no confirmed submission found within {within_days} days",
                application_id=application_id,
            )
            return SubmissionReservation(
                decision=SubmissionDecision.RESERVED,
                application_id=application_id,
            )

    def mark_submitted(
        self,
        application_id: int,
        *,
        confirmation: str = "",
        confirmation_source: ConfirmationSource = ConfirmationSource.BROWSER,
        now: datetime | None = None,
    ) -> ApplicationHistoryEntry:
        return self._mark(
            application_id,
            LedgerState.SUBMITTED,
            confirmation=confirmation,
            confirmation_source=confirmation_source,
            applied_at=now or _utc_now(),
            audit_action="submission_confirmed",
        )

    def mark_submission_unknown(
        self,
        application_id: int,
        *,
        details: str = "",
    ) -> ApplicationHistoryEntry:
        return self._mark(
            application_id,
            LedgerState.SUBMISSION_UNKNOWN,
            audit_details=details,
            audit_action="submission_unknown",
        )

    def mark_failed(self, application_id: int, *, details: str = "") -> ApplicationHistoryEntry:
        return self._mark(
            application_id,
            LedgerState.FAILED,
            audit_details=details,
            audit_action="submission_failed",
        )

    def confirm_with_provider(
        self,
        application_id: int,
        provider: SubmissionConfirmationProvider,
    ) -> ApplicationHistoryEntry | None:
        """Resolve a pending attempt at the end of the flow using any confirmation provider."""
        entry = self.get(application_id)
        if entry is None:
            raise KeyError(f"application history id {application_id} does not exist")
        evidence = provider.find_confirmation(
            company=entry.company,
            job_title=entry.job_title,
            submitted_after=datetime.fromisoformat(entry.updated_at),
        )
        if evidence is None:
            return None
        return self.mark_submitted(
            application_id,
            confirmation=evidence.detail,
            confirmation_source=evidence.source,
            now=evidence.observed_at,
        )

    def record_existing_submission(
        self,
        *,
        company: str,
        job_title: str,
        applied_at: datetime,
        confirmation: str = "confirmed in browser",
        confirmation_source: ConfirmationSource = ConfirmationSource.BROWSER,
        source_url: str = "",
    ) -> ApplicationHistoryEntry:
        """Seed a known confirmed submission without duplicating a recent record."""
        reconciled = self._reconcile_title_variant(
            company=company,
            job_title=job_title,
            applied_at=applied_at,
            confirmation=confirmation,
            confirmation_source=confirmation_source,
            source_url=source_url,
        )
        if reconciled is not None:
            return reconciled
        reservation = self.reserve_submission(
            company=company,
            job_title=job_title,
            source_url=source_url,
            now=applied_at,
        )
        if reservation.allowed and reservation.application_id is not None:
            return self.mark_submitted(
                reservation.application_id,
                confirmation=confirmation,
                confirmation_source=confirmation_source,
                now=applied_at,
            )
        if reservation.matched_application_id is None:
            raise RuntimeError("submission history returned no matching application")
        entry = self.get(reservation.matched_application_id)
        if entry is None:
            raise RuntimeError("matching submission history entry was not found")
        if entry.confirmation_source is None:
            return self.mark_submitted(
                entry.id,
                confirmation=entry.confirmation or confirmation,
                confirmation_source=confirmation_source,
                now=datetime.fromisoformat(entry.applied_at) if entry.applied_at else applied_at,
            )
        return entry

    def _reconcile_title_variant(
        self,
        *,
        company: str,
        job_title: str,
        applied_at: datetime,
        confirmation: str,
        confirmation_source: ConfirmationSource,
        source_url: str,
    ) -> ApplicationHistoryEntry | None:
        """Update one unambiguous same-day expanded title instead of inserting a duplicate."""
        company_value, title_value = self._validated_identity(company, job_title)
        company_key = normalize_exact_identity(company_value)
        title_key = normalize_exact_identity(title_value)
        timestamp = applied_at.astimezone(timezone.utc).isoformat()
        safe_url = _safe_source_url(source_url)
        provider, provider_job_id = _provider_identity(source_url)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            company_id = self._ensure_company(connection, company_value, company_key, timestamp)
            if provider and provider_job_id:
                provider_match = connection.execute(
                    """
                    SELECT a.id
                    FROM applications AS a
                    JOIN job_postings AS j ON j.id = a.job_posting_id
                    WHERE j.provider = ? AND j.provider_job_id = ?
                      AND a.state = ?
                    LIMIT 1
                    """,
                    (provider, provider_job_id, LedgerState.SUBMITTED.value),
                ).fetchone()
                if provider_match:
                    self._update_application_identity(
                        connection,
                        application_id=provider_match["id"],
                        company_id=company_id,
                        company=company_value,
                        company_key=company_key,
                        job_title=title_value,
                        title_key=title_key,
                        provider=provider,
                        provider_job_id=provider_job_id,
                        source_url=safe_url,
                        timestamp=timestamp,
                    )
                    application_id = int(provider_match["id"])
                    connection.commit()
                    return self.get(application_id)

            candidates = connection.execute(
                """
                SELECT id, job_title
                FROM applications
                WHERE company_key = ? AND state = ?
                  AND substr(applied_at, 1, 10) = ?
                """,
                (company_key, LedgerState.SUBMITTED.value, timestamp[:10]),
            ).fetchall()
            variants = [
                row for row in candidates if _title_is_expanded_variant(row["job_title"], title_value)
            ]
            if len(variants) != 1:
                return None
            application_id = int(variants[0]["id"])
            self._update_application_identity(
                connection,
                application_id=application_id,
                company_id=company_id,
                company=company_value,
                company_key=company_key,
                job_title=title_value,
                title_key=title_key,
                provider=provider,
                provider_job_id=provider_job_id,
                source_url=safe_url,
                timestamp=timestamp,
            )
            self._insert_audit(
                connection,
                timestamp,
                company_value,
                title_value,
                "identity_reconciled",
                LedgerState.SUBMITTED.value,
                "same-day expanded Indeed title matched one existing application",
                application_id=application_id,
            )
        entry = self.get(application_id)
        if entry is None:
            raise RuntimeError("reconciled application history entry was not found")
        return entry

    def get(self, application_id: int) -> ApplicationHistoryEntry | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM applications WHERE id = ?",
                (application_id,),
            ).fetchone()
        return self._entry(row) if row else None

    def recent_submissions(
        self,
        *,
        within_days: int = 30,
        now: datetime | None = None,
    ) -> list[ApplicationHistoryEntry]:
        timestamp = (now or _utc_now()).astimezone(timezone.utc)
        cutoff = (timestamp - timedelta(days=within_days)).isoformat()
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM applications
                WHERE state = ? AND applied_at >= ?
                ORDER BY applied_at DESC
                """,
                (LedgerState.SUBMITTED.value, cutoff),
            ).fetchall()
        return [self._entry(row) for row in rows]

    def _mark(
        self,
        application_id: int,
        state: LedgerState,
        *,
        confirmation: str = "",
        confirmation_source: ConfirmationSource | None = None,
        audit_details: str = "",
        audit_action: str,
        applied_at: datetime | None = None,
    ) -> ApplicationHistoryEntry:
        timestamp = _utc_now().isoformat()
        applied_at_text = (
            applied_at.astimezone(timezone.utc).isoformat() if applied_at is not None else None
        )
        safe_confirmation = redact(confirmation, limit=500)
        safe_audit_details = redact(audit_details or confirmation, limit=500)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM applications WHERE id = ?",
                (application_id,),
            ).fetchone()
            if row is None:
                raise KeyError(f"application history id {application_id} does not exist")
            connection.execute(
                """
                UPDATE applications
                SET state = ?, applied_at = COALESCE(?, applied_at),
                    updated_at = ?, confirmation = ?, confirmation_source = ?
                WHERE id = ?
                """,
                (
                    state.value,
                    applied_at_text,
                    timestamp,
                    safe_confirmation,
                    confirmation_source.value if confirmation_source else "",
                    application_id,
                ),
            )
            self._insert_audit(
                connection,
                timestamp,
                row["company"],
                row["job_title"],
                audit_action,
                state.value,
                safe_audit_details,
                application_id=application_id,
            )
        entry = self.get(application_id)
        if entry is None:
            raise RuntimeError("updated application history entry was not found")
        return entry

    @staticmethod
    def _validated_identity(company: str, job_title: str) -> tuple[str, str]:
        company_value = " ".join(company.split())
        title_value = " ".join(job_title.split())
        if not company_value or not title_value:
            raise ValueError("company and exact job title are required")
        return company_value, title_value

    @staticmethod
    def _insert_audit(
        connection: sqlite3.Connection,
        event_at: str,
        company: str,
        job_title: str,
        action: str,
        decision: str,
        details: str,
        *,
        application_id: int | None = None,
    ) -> None:
        connection.execute(
            """
            INSERT INTO submission_audit (
                application_id, event_at, company, job_title, action, decision, details
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                application_id,
                event_at,
                company,
                job_title,
                action,
                decision,
                redact(details, limit=500),
            ),
        )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS applications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company TEXT NOT NULL,
                    job_title TEXT NOT NULL,
                    company_key TEXT NOT NULL,
                    job_title_key TEXT NOT NULL,
                    state TEXT NOT NULL,
                    applied_at TEXT,
                    updated_at TEXT NOT NULL,
                    confirmation TEXT NOT NULL DEFAULT '',
                    confirmation_source TEXT NOT NULL DEFAULT '',
                    source_domain TEXT NOT NULL DEFAULT '',
                    source_url TEXT NOT NULL DEFAULT '',
                    company_id INTEGER,
                    job_posting_id INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_applications_recent_exact
                    ON applications(company_key, job_title_key, state, applied_at);
                CREATE INDEX IF NOT EXISTS idx_applications_unresolved_exact
                    ON applications(company_key, job_title_key, state, updated_at);

                CREATE TABLE IF NOT EXISTS submission_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    application_id INTEGER,
                    event_at TEXT NOT NULL,
                    company TEXT NOT NULL,
                    job_title TEXT NOT NULL,
                    action TEXT NOT NULL,
                    decision TEXT NOT NULL,
                    details TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY(application_id) REFERENCES applications(id)
                );
                CREATE INDEX IF NOT EXISTS idx_submission_audit_application
                    ON submission_audit(application_id, event_at);

                CREATE TABLE IF NOT EXISTS companies (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    name_key TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS job_postings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    provider TEXT NOT NULL DEFAULT '',
                    provider_job_id TEXT NOT NULL DEFAULT '',
                    canonical_title TEXT NOT NULL,
                    title_key TEXT NOT NULL,
                    source_url TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(company_id) REFERENCES companies(id)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_job_postings_provider_identity
                    ON job_postings(provider, provider_job_id)
                    WHERE provider <> '' AND provider_job_id <> '';
                CREATE INDEX IF NOT EXISTS idx_job_postings_company_title
                    ON job_postings(company_id, title_key);
                CREATE TABLE IF NOT EXISTS job_title_aliases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_posting_id INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    title_key TEXT NOT NULL,
                    observed_at TEXT NOT NULL,
                    FOREIGN KEY(job_posting_id) REFERENCES job_postings(id),
                    UNIQUE(job_posting_id, title_key)
                );
                """
            )
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(applications)").fetchall()
            }
            if "confirmation_source" not in columns:
                connection.execute(
                    "ALTER TABLE applications "
                    "ADD COLUMN confirmation_source TEXT NOT NULL DEFAULT ''"
                )
            if "company_id" not in columns:
                connection.execute("ALTER TABLE applications ADD COLUMN company_id INTEGER")
            if "job_posting_id" not in columns:
                connection.execute("ALTER TABLE applications ADD COLUMN job_posting_id INTEGER")
            self._backfill_normalized_identities(connection)

    def _backfill_normalized_identities(self, connection: sqlite3.Connection) -> None:
        timestamp = _utc_now().isoformat()
        rows = connection.execute(
            """
            SELECT id, company, company_key, job_title, job_title_key, source_url
            FROM applications
            WHERE company_id IS NULL OR job_posting_id IS NULL
            ORDER BY id
            """
        ).fetchall()
        for row in rows:
            company_id = self._ensure_company(
                connection,
                row["company"],
                row["company_key"],
                timestamp,
            )
            provider, provider_job_id = _provider_identity(row["source_url"])
            posting_id = self._ensure_job_posting(
                connection,
                company_id=company_id,
                job_title=row["job_title"],
                title_key=row["job_title_key"],
                provider=provider,
                provider_job_id=provider_job_id,
                source_url=row["source_url"],
                timestamp=timestamp,
            )
            connection.execute(
                "UPDATE applications SET company_id = ?, job_posting_id = ? WHERE id = ?",
                (company_id, posting_id, row["id"]),
            )

    @staticmethod
    def _ensure_company(
        connection: sqlite3.Connection,
        name: str,
        name_key: str,
        timestamp: str,
    ) -> int:
        connection.execute(
            """
            INSERT INTO companies (name, name_key, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(name_key) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
            """,
            (name, name_key, timestamp, timestamp),
        )
        row = connection.execute(
            "SELECT id FROM companies WHERE name_key = ?",
            (name_key,),
        ).fetchone()
        return int(row["id"])

    @staticmethod
    def _ensure_job_posting(
        connection: sqlite3.Connection,
        *,
        company_id: int,
        job_title: str,
        title_key: str,
        provider: str,
        provider_job_id: str,
        source_url: str,
        timestamp: str,
    ) -> int:
        row = None
        if provider and provider_job_id:
            row = connection.execute(
                "SELECT id FROM job_postings WHERE provider = ? AND provider_job_id = ?",
                (provider, provider_job_id),
            ).fetchone()
        if row is None:
            row = connection.execute(
                """
                SELECT id FROM job_postings
                WHERE company_id = ? AND title_key = ?
                ORDER BY id LIMIT 1
                """,
                (company_id, title_key),
            ).fetchone()
        if row is None:
            cursor = connection.execute(
                """
                INSERT INTO job_postings (
                    company_id, provider, provider_job_id, canonical_title, title_key,
                    source_url, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    company_id,
                    provider,
                    provider_job_id,
                    job_title,
                    title_key,
                    source_url,
                    timestamp,
                    timestamp,
                ),
            )
            posting_id = int(cursor.lastrowid)
        else:
            posting_id = int(row["id"])
            connection.execute(
                """
                UPDATE job_postings
                SET provider = CASE WHEN provider = '' THEN ? ELSE provider END,
                    provider_job_id = CASE WHEN provider_job_id = '' THEN ? ELSE provider_job_id END,
                    canonical_title = ?, title_key = ?,
                    source_url = CASE WHEN ? <> '' THEN ? ELSE source_url END,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    provider,
                    provider_job_id,
                    job_title,
                    title_key,
                    source_url,
                    source_url,
                    timestamp,
                    posting_id,
                ),
            )
        connection.execute(
            """
            INSERT INTO job_title_aliases (job_posting_id, title, title_key, observed_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(job_posting_id, title_key) DO UPDATE
            SET title = excluded.title, observed_at = excluded.observed_at
            """,
            (posting_id, job_title, title_key, timestamp),
        )
        return posting_id

    def _update_application_identity(
        self,
        connection: sqlite3.Connection,
        *,
        application_id: int,
        company_id: int,
        company: str,
        company_key: str,
        job_title: str,
        title_key: str,
        provider: str,
        provider_job_id: str,
        source_url: str,
        timestamp: str,
    ) -> None:
        old = connection.execute(
            "SELECT job_title, job_title_key FROM applications WHERE id = ?",
            (application_id,),
        ).fetchone()
        posting_id = self._ensure_job_posting(
            connection,
            company_id=company_id,
            job_title=old["job_title"],
            title_key=old["job_title_key"],
            provider=provider,
            provider_job_id=provider_job_id,
            source_url=source_url,
            timestamp=timestamp,
        )
        connection.execute(
            """
            INSERT INTO job_title_aliases (job_posting_id, title, title_key, observed_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(job_posting_id, title_key) DO UPDATE
            SET title = excluded.title, observed_at = excluded.observed_at
            """,
            (posting_id, job_title, title_key, timestamp),
        )
        connection.execute(
            """
            UPDATE job_postings
            SET canonical_title = ?, title_key = ?, updated_at = ?
            WHERE id = ?
            """,
            (job_title, title_key, timestamp, posting_id),
        )
        connection.execute(
            """
            UPDATE applications
            SET company = ?, company_key = ?, job_title = ?, job_title_key = ?,
                source_domain = ?, source_url = ?, company_id = ?, job_posting_id = ?
            WHERE id = ?
            """,
            (
                company,
                company_key,
                job_title,
                title_key,
                (urlsplit(source_url).hostname or "").lower(),
                source_url,
                company_id,
                posting_id,
                application_id,
            ),
        )

    @staticmethod
    def _entry(row: sqlite3.Row) -> ApplicationHistoryEntry:
        return ApplicationHistoryEntry(
            id=row["id"],
            company=row["company"],
            job_title=row["job_title"],
            state=LedgerState(row["state"]),
            applied_at=row["applied_at"] or "",
            updated_at=row["updated_at"],
            confirmation=row["confirmation"],
            confirmation_source=(
                ConfirmationSource(row["confirmation_source"])
                if row["confirmation_source"]
                else None
            ),
            source_domain=row["source_domain"],
            source_url=row["source_url"],
            company_id=row["company_id"] if "company_id" in row.keys() else None,
            job_posting_id=row["job_posting_id"] if "job_posting_id" in row.keys() else None,
        )


def default_submission_history() -> ApplicationSubmissionHistory:
    """Return the persistent history used by normal application runs."""
    return ApplicationSubmissionHistory(DEFAULT_SUBMISSION_HISTORY_PATH)
