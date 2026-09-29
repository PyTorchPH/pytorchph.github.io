"""SQLite-backed verified identity and resume-routing configuration."""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass(frozen=True)
class VerifiedApplicationIdentity:
    first_name: str
    last_name: str
    country_name: str
    country_iso: str
    phone_calling_code: str
    verified_phone: str = ""

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()


@dataclass(frozen=True)
class StoredResumeRoute:
    filename: str
    terms: tuple[str, ...]
    is_default: bool = False


@dataclass(frozen=True)
class OnboardingPreferences:
    target: int
    target_countries: tuple[str, ...]
    work_mode: str
    employment_type: str
    safe_auto_start: bool
    updated_at: str


class ApplicationProfileStore:
    """Persist structured user facts separately from resumes and browser state."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def save_verified_identity(
        self,
        *,
        first_name: str,
        last_name: str,
        country_name: str,
        country_iso: str,
        phone_calling_code: str,
        verified_phone: str = "",
    ) -> VerifiedApplicationIdentity:
        identity = self._validated_identity(
            first_name=first_name,
            last_name=last_name,
            country_name=country_name,
            country_iso=country_iso,
            phone_calling_code=phone_calling_code,
            verified_phone=verified_phone,
        )
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO verified_application_profile (
                    singleton_id, first_name, last_name, country_name, country_iso,
                    phone_calling_code, verified_phone, updated_at
                ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(singleton_id) DO UPDATE SET
                    first_name = excluded.first_name,
                    last_name = excluded.last_name,
                    country_name = excluded.country_name,
                    country_iso = excluded.country_iso,
                    phone_calling_code = excluded.phone_calling_code,
                    verified_phone = excluded.verified_phone,
                    updated_at = excluded.updated_at
                """,
                (
                    identity.first_name,
                    identity.last_name,
                    identity.country_name,
                    identity.country_iso,
                    identity.phone_calling_code,
                    identity.verified_phone,
                    now,
                ),
            )
        return identity

    def verified_identity(self) -> VerifiedApplicationIdentity | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT first_name, last_name, country_name, country_iso,
                       phone_calling_code, verified_phone
                FROM verified_application_profile
                WHERE singleton_id = 1
                """
            ).fetchone()
        if row is None:
            return None
        return VerifiedApplicationIdentity(
            first_name=row["first_name"],
            last_name=row["last_name"],
            country_name=row["country_name"],
            country_iso=row["country_iso"],
            phone_calling_code=row["phone_calling_code"],
            verified_phone=row["verified_phone"],
        )

    def replace_resume_route(
        self,
        *,
        filename: str,
        terms: list[str] | tuple[str, ...],
        is_default: bool = False,
    ) -> StoredResumeRoute:
        clean_filename = filename.strip()
        if (
            not clean_filename
            or Path(clean_filename).name != clean_filename
            or Path(clean_filename).suffix.casefold() != ".pdf"
        ):
            raise ValueError("resume filename must be one local PDF basename")
        clean_terms = tuple(
            dict.fromkeys(term.strip().casefold() for term in terms if term.strip())
        )
        if not clean_terms:
            raise ValueError("at least one nonempty resume-routing term is required")
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            if is_default:
                connection.execute("UPDATE resume_routes SET is_default = 0")
            connection.execute(
                """
                INSERT INTO resume_routes (
                    filename, terms_json, is_default, enabled, updated_at
                ) VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(filename) DO UPDATE SET
                    terms_json = excluded.terms_json,
                    is_default = excluded.is_default,
                    enabled = 1,
                    updated_at = excluded.updated_at
                """,
                (
                    clean_filename,
                    json.dumps(clean_terms, ensure_ascii=False),
                    int(is_default),
                    now,
                ),
            )
        return StoredResumeRoute(clean_filename, clean_terms, is_default)

    def resume_routes(self) -> tuple[StoredResumeRoute, ...]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT filename, terms_json, is_default
                FROM resume_routes
                WHERE enabled = 1
                ORDER BY filename
                """
            ).fetchall()
        return tuple(
            StoredResumeRoute(
                filename=row["filename"],
                terms=tuple(json.loads(row["terms_json"])),
                is_default=bool(row["is_default"]),
            )
            for row in rows
        )

    def save_onboarding_answer(self, field: str, value: dict[str, str]) -> None:
        if field not in {"name", "country", "phone"}:
            raise ValueError("unsupported onboarding field")
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO onboarding_answers (field, value_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(field) DO UPDATE SET
                    value_json = excluded.value_json,
                    updated_at = excluded.updated_at
                """,
                (field, json.dumps(value, ensure_ascii=False), _now()),
            )

    def onboarding_answers(self) -> dict[str, dict[str, str]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT field, value_json FROM onboarding_answers ORDER BY field"
            ).fetchall()
        answers: dict[str, dict[str, str]] = {}
        for row in rows:
            try:
                value = json.loads(row["value_json"])
            except (json.JSONDecodeError, TypeError):
                continue
            if isinstance(value, dict):
                answers[row["field"]] = {
                    str(key): str(item) for key, item in value.items()
                }
        return answers

    def clear_onboarding_answers(self) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM onboarding_answers")

    def save_onboarding_preferences(
        self,
        *,
        target: int,
        target_countries: list[str] | tuple[str, ...],
        work_mode: str,
        employment_type: str,
        safe_auto_start: bool,
    ) -> OnboardingPreferences:
        countries = tuple(dict.fromkeys(item.strip() for item in target_countries if item.strip()))
        if not countries:
            countries = ("Philippines",)
        if target < 1 or target > 100:
            raise ValueError("application target must be between 1 and 100")
        if any(item not in {"Philippines", "Australia", "Canada"} for item in countries):
            raise ValueError("select Philippines, Australia, and/or Canada")
        if work_mode != "remote":
            raise ValueError("Indeed v1 requires remote work mode")
        if employment_type != "contract":
            raise ValueError("Indeed v1 requires contract employment type")
        updated_at = _now()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO onboarding_preferences (
                    singleton_id, target, target_countries_json, work_mode,
                    employment_type, safe_auto_start, updated_at
                ) VALUES (1, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(singleton_id) DO UPDATE SET
                    target = excluded.target,
                    target_countries_json = excluded.target_countries_json,
                    work_mode = excluded.work_mode,
                    employment_type = excluded.employment_type,
                    safe_auto_start = excluded.safe_auto_start,
                    updated_at = excluded.updated_at
                """,
                (
                    target,
                    json.dumps(countries, ensure_ascii=False),
                    work_mode,
                    employment_type,
                    int(safe_auto_start),
                    updated_at,
                ),
            )
        saved = self.onboarding_preferences()
        if saved is None:  # pragma: no cover - SQLite write/read invariant
            raise RuntimeError("onboarding preferences were not persisted")
        return saved

    def onboarding_preferences(self) -> OnboardingPreferences | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM onboarding_preferences WHERE singleton_id = 1"
            ).fetchone()
        if row is None:
            return None
        return OnboardingPreferences(
            target=int(row["target"]),
            target_countries=tuple(json.loads(row["target_countries_json"])),
            work_mode=row["work_mode"],
            employment_type=row["employment_type"],
            safe_auto_start=bool(row["safe_auto_start"]),
            updated_at=row["updated_at"],
        )

    def auto_started_goal(self, activation_key: str) -> str:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT goal_id FROM onboarding_auto_starts WHERE activation_key = ?",
                (activation_key,),
            ).fetchone()
        return str(row["goal_id"]) if row else ""

    def mark_auto_started(self, activation_key: str, goal_id: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT OR IGNORE INTO onboarding_auto_starts (
                    activation_key, goal_id, created_at
                ) VALUES (?, ?, ?)
                """,
                (activation_key, goal_id, _now()),
            )

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS verified_application_profile (
                    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
                    first_name TEXT NOT NULL,
                    last_name TEXT NOT NULL,
                    country_name TEXT NOT NULL,
                    country_iso TEXT NOT NULL,
                    phone_calling_code TEXT NOT NULL,
                    verified_phone TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS resume_routes (
                    filename TEXT PRIMARY KEY,
                    terms_json TEXT NOT NULL,
                    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
                    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
                    updated_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_routes_one_default
                    ON resume_routes(is_default) WHERE is_default = 1 AND enabled = 1;
                CREATE TABLE IF NOT EXISTS onboarding_answers (
                    field TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS onboarding_preferences (
                    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
                    target INTEGER NOT NULL CHECK (target BETWEEN 1 AND 100),
                    target_countries_json TEXT NOT NULL,
                    work_mode TEXT NOT NULL,
                    employment_type TEXT NOT NULL,
                    safe_auto_start INTEGER NOT NULL CHECK (safe_auto_start IN (0, 1)),
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS onboarding_auto_starts (
                    activation_key TEXT PRIMARY KEY,
                    goal_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _validated_identity(
        *,
        first_name: str,
        last_name: str,
        country_name: str,
        country_iso: str,
        phone_calling_code: str,
        verified_phone: str,
    ) -> VerifiedApplicationIdentity:
        values = {
            "first_name": first_name.strip(),
            "last_name": last_name.strip(),
            "country_name": country_name.strip(),
        }
        if any(not value for value in values.values()):
            raise ValueError("first name, last name, and country name are required")
        iso = country_iso.strip().upper()
        if not re.fullmatch(r"[A-Z]{2}", iso):
            raise ValueError("country ISO must contain exactly two letters")
        calling_code = phone_calling_code.strip()
        if not re.fullmatch(r"\+\d{1,4}", calling_code):
            raise ValueError("phone calling code must use + followed by 1-4 digits")
        phone = verified_phone.strip()
        if phone and not re.fullmatch(r"\+?[\d ()-]{7,24}", phone):
            raise ValueError("verified phone has an unsupported format")
        return VerifiedApplicationIdentity(
            first_name=values["first_name"],
            last_name=values["last_name"],
            country_name=values["country_name"],
            country_iso=iso,
            phone_calling_code=calling_code,
            verified_phone=phone,
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
