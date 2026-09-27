"""SQLite persistence for market-fit campaigns and interview funnels."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

from .assessment import build_analytics
from .models import (
    ApplicationMode,
    FitAssessment,
    FunnelEvent,
    FunnelEventCreate,
    FunnelStage,
    InterviewPrepPlan,
    JobDemandDraft,
    JobDemandProfile,
    MarketFitAnalytics,
    MarketFitCampaign,
    MarketOpportunity,
    MarketOpportunityCreate,
    MarketOpportunityUpdate,
    MarketTrack,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _safe_url(value: str) -> str:
    parts = urlsplit(value)
    return f"{parts.scheme}://{parts.netloc}{parts.path}" if parts.scheme and parts.netloc else ""


class MarketFitStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def campaign(self) -> MarketFitCampaign:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM market_fit_campaigns WHERE id = 'default'"
            ).fetchone()
        if row:
            return MarketFitCampaign.model_validate_json(row["payload"])
        return self.save_campaign(MarketFitCampaign())

    def save_campaign(self, campaign: MarketFitCampaign) -> MarketFitCampaign:
        updated = campaign.model_copy(update={"updated_at": _now()})
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                INSERT INTO market_fit_campaigns (id, payload, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
                """,
                (updated.id, updated.model_dump_json(), updated.updated_at.isoformat()),
            )
            connection.execute("DELETE FROM market_fit_assessments")
        return updated

    def create_opportunity(
        self,
        value: MarketOpportunityCreate,
        *,
        source_application_id: int | None = None,
    ) -> MarketOpportunity:
        timestamp = _now()
        opportunity_id = uuid.uuid4().hex
        safe_url = _safe_url(value.source_url)
        source_domain = value.source_domain or (urlsplit(safe_url).hostname or "")
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if source_application_id is not None:
                existing = connection.execute(
                    "SELECT id FROM market_fit_opportunities WHERE source_application_id = ?",
                    (source_application_id,),
                ).fetchone()
                if existing:
                    return self.get_opportunity(existing["id"])
            connection.execute(
                """
                INSERT INTO market_fit_opportunities (
                    id, source_application_id, company, job_title, source_url, source_domain,
                    description, track, application_mode, resume_file, applied_at,
                    employment_type, job_level, salary_signal, salary_monthly_min_php,
                    salary_monthly_max_php, salary_band, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    opportunity_id,
                    source_application_id,
                    value.company,
                    value.job_title,
                    safe_url,
                    source_domain,
                    value.description,
                    value.track.value,
                    value.application_mode.value,
                    value.resume_file,
                    value.applied_at.isoformat() if value.applied_at else None,
                    value.employment_type,
                    value.job_level.value,
                    value.salary_signal,
                    value.salary_monthly_min_php,
                    value.salary_monthly_max_php,
                    value.salary_band.value,
                    timestamp.isoformat(),
                    timestamp.isoformat(),
                ),
            )
            if value.applied_at:
                connection.execute(
                    """
                    INSERT INTO market_fit_events (opportunity_id, stage, occurred_at, note, source)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        opportunity_id,
                        FunnelStage.APPLIED.value,
                        value.applied_at.isoformat(),
                        "Confirmed submission imported."
                        if source_application_id
                        else "Application recorded.",
                        "submission_history" if source_application_id else "manual",
                    ),
                )
        return self.get_opportunity(opportunity_id)

    def sync_confirmed_submissions(self) -> int:
        with self._connect() as connection:
            exists = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'applications'"
            ).fetchone()
            if exists is None:
                return 0
            rows = connection.execute(
                """
                SELECT id, company, job_title, source_url, source_domain, applied_at
                FROM applications WHERE state = 'submitted' AND applied_at IS NOT NULL
                ORDER BY applied_at
                """
            ).fetchall()
            goal_rows = (
                connection.execute(
                    """
                SELECT company, job_title, salary_signal, salary_monthly_min_php,
                       salary_monthly_max_php, salary_band, job_level
                FROM application_goal_items WHERE state = 'confirmed'
                """
                ).fetchall()
                if connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'application_goal_items'"
                ).fetchone()
                else []
            )
        goal_evidence = {
            (
                " ".join(row["company"].casefold().split()),
                " ".join(row["job_title"].casefold().split()),
            ): row
            for row in goal_rows
        }
        created = 0
        for row in rows:
            evidence = goal_evidence.get(
                (
                    " ".join(row["company"].casefold().split()),
                    " ".join(row["job_title"].casefold().split()),
                )
            )
            before = self._source_exists(row["id"])
            self.create_opportunity(
                MarketOpportunityCreate(
                    company=row["company"],
                    job_title=row["job_title"],
                    source_url=row["source_url"],
                    source_domain=row["source_domain"],
                    track=MarketTrack.CONTRACT,
                    application_mode=ApplicationMode.AUTOMATED,
                    applied_at=datetime.fromisoformat(row["applied_at"]),
                    job_level=evidence["job_level"] if evidence else "unknown",
                    salary_signal=evidence["salary_signal"] if evidence else "",
                    salary_monthly_min_php=evidence["salary_monthly_min_php"] if evidence else None,
                    salary_monthly_max_php=evidence["salary_monthly_max_php"] if evidence else None,
                    salary_band=evidence["salary_band"] if evidence else "unknown",
                ),
                source_application_id=row["id"],
            )
            created += int(not before)
        return created

    def _source_exists(self, source_application_id: int) -> bool:
        with self._connect() as connection:
            return (
                connection.execute(
                    "SELECT 1 FROM market_fit_opportunities WHERE source_application_id = ?",
                    (source_application_id,),
                ).fetchone()
                is not None
            )

    def opportunities(self) -> list[MarketOpportunity]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM market_fit_opportunities ORDER BY COALESCE(applied_at, created_at) DESC"
            ).fetchall()
        return [self._opportunity(row) for row in rows]

    def update_opportunity(
        self,
        opportunity_id: str,
        value: MarketOpportunityUpdate,
    ) -> MarketOpportunity:
        current = self.get_opportunity(opportunity_id)
        requested = value.model_dump(exclude_none=True)
        changes = {key: item for key, item in requested.items() if getattr(current, key) != item}
        if not changes:
            return current
        assignments = []
        parameters = []
        for key, item in changes.items():
            assignments.append(f"{key} = ?")
            parameters.append(item.value if hasattr(item, "value") else item)
        assignments.append("updated_at = ?")
        parameters.extend((_now().isoformat(), opportunity_id))
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                f"UPDATE market_fit_opportunities SET {', '.join(assignments)} WHERE id = ?",
                parameters,
            )
            if connection.total_changes == 0:
                raise KeyError(opportunity_id)
            if "description" in changes:
                connection.execute(
                    "DELETE FROM market_fit_demands WHERE opportunity_id = ?", (opportunity_id,)
                )
            if {"description", "resume_file", "track"} & changes.keys():
                connection.execute(
                    "DELETE FROM market_fit_assessments WHERE opportunity_id = ?",
                    (opportunity_id,),
                )
                connection.execute(
                    "DELETE FROM market_fit_interview_prep WHERE opportunity_id = ?",
                    (opportunity_id,),
                )
        return self.get_opportunity(opportunity_id)

    def get_opportunity(self, opportunity_id: str) -> MarketOpportunity:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM market_fit_opportunities WHERE id = ?", (opportunity_id,)
            ).fetchone()
        if row is None:
            raise KeyError(opportunity_id)
        return self._opportunity(row)

    def save_demand_draft(self, opportunity_id: str, draft: JobDemandDraft) -> JobDemandProfile:
        self.get_opportunity(opportunity_id)
        profile = JobDemandProfile(opportunity_id=opportunity_id, **draft.model_dump())
        self._save_demand(profile)
        return profile

    def approve_demands(self, opportunity_id: str, draft: JobDemandDraft) -> JobDemandProfile:
        self.get_opportunity(opportunity_id)
        profile = JobDemandProfile(
            opportunity_id=opportunity_id,
            verified=True,
            verified_at=_now(),
            **draft.model_dump(),
        )
        self._save_demand(profile)
        return profile

    def _save_demand(self, profile: JobDemandProfile) -> None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                INSERT INTO market_fit_demands (opportunity_id, payload, verified, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(opportunity_id) DO UPDATE SET
                  payload = excluded.payload, verified = excluded.verified, updated_at = excluded.updated_at
                """,
                (
                    profile.opportunity_id,
                    profile.model_dump_json(),
                    int(profile.verified),
                    _now().isoformat(),
                ),
            )
            connection.execute(
                "DELETE FROM market_fit_assessments WHERE opportunity_id = ?",
                (profile.opportunity_id,),
            )
            connection.execute(
                "DELETE FROM market_fit_interview_prep WHERE opportunity_id = ?",
                (profile.opportunity_id,),
            )

    def demands(self, opportunity_id: str) -> JobDemandProfile | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM market_fit_demands WHERE opportunity_id = ?",
                (opportunity_id,),
            ).fetchone()
        return JobDemandProfile.model_validate_json(row["payload"]) if row else None

    def save_assessment(self, assessment: FitAssessment) -> FitAssessment:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO market_fit_assessments (opportunity_id, payload, updated_at)
                VALUES (?, ?, ?) ON CONFLICT(opportunity_id) DO UPDATE SET
                payload = excluded.payload, updated_at = excluded.updated_at
                """,
                (assessment.opportunity_id, assessment.model_dump_json(), _now().isoformat()),
            )
        return assessment

    def assessment(self, opportunity_id: str) -> FitAssessment | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM market_fit_assessments WHERE opportunity_id = ?",
                (opportunity_id,),
            ).fetchone()
        return FitAssessment.model_validate_json(row["payload"]) if row else None

    def add_event(self, opportunity_id: str, value: FunnelEventCreate) -> FunnelEvent:
        self.get_opportunity(opportunity_id)
        occurred = value.occurred_at or _now()
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO market_fit_events (opportunity_id, stage, occurred_at, note, source)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    opportunity_id,
                    value.stage.value,
                    occurred.isoformat(),
                    value.note[:1000],
                    value.source,
                ),
            )
            connection.execute(
                "UPDATE market_fit_opportunities SET updated_at = ? WHERE id = ?",
                (_now().isoformat(), opportunity_id),
            )
        return FunnelEvent(
            id=cursor.lastrowid,
            opportunity_id=opportunity_id,
            occurred_at=occurred,
            **value.model_dump(exclude={"occurred_at"}),
        )

    def events(self, opportunity_id: str) -> list[FunnelEvent]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM market_fit_events WHERE opportunity_id = ? ORDER BY occurred_at, id",
                (opportunity_id,),
            ).fetchall()
        return [
            FunnelEvent(
                id=row["id"],
                opportunity_id=row["opportunity_id"],
                stage=row["stage"],
                occurred_at=datetime.fromisoformat(row["occurred_at"]),
                note=row["note"],
                source=row["source"],
            )
            for row in rows
        ]

    def apply_ghosting(self, *, now: datetime | None = None) -> int:
        campaign = self.campaign()
        cutoff = (now or _now()) - timedelta(days=campaign.ghost_after_days)
        changed = 0
        for opportunity in self.opportunities():
            events = self.events(opportunity.id)
            stages = {item.stage for item in events}
            if FunnelStage.APPLIED not in stages or FunnelStage.RECRUITER_RESPONSE in stages:
                continue
            if stages & {FunnelStage.REJECTED, FunnelStage.WITHDRAWN, FunnelStage.GHOSTED}:
                continue
            applied = min(item.occurred_at for item in events if item.stage == FunnelStage.APPLIED)
            if applied <= cutoff:
                self.add_event(
                    opportunity.id,
                    FunnelEventCreate(
                        stage=FunnelStage.GHOSTED,
                        occurred_at=now or _now(),
                        note=f"No recruiter response within configured {campaign.ghost_after_days}-day window.",
                        source="configured_rule",
                    ),
                )
                changed += 1
        return changed

    def save_prep(self, plan: InterviewPrepPlan) -> InterviewPrepPlan:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO market_fit_interview_prep (opportunity_id, payload, updated_at)
                VALUES (?, ?, ?) ON CONFLICT(opportunity_id) DO UPDATE SET
                payload = excluded.payload, updated_at = excluded.updated_at
                """,
                (plan.opportunity_id, plan.model_dump_json(), _now().isoformat()),
            )
        return plan

    def approve_prep(self, opportunity_id: str) -> InterviewPrepPlan:
        plan = self.prep(opportunity_id)
        if plan is None:
            raise ValueError("interview preparation has not been generated")
        return self.save_prep(plan.model_copy(update={"approved": True}))

    def prep(self, opportunity_id: str) -> InterviewPrepPlan | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM market_fit_interview_prep WHERE opportunity_id = ?",
                (opportunity_id,),
            ).fetchone()
        return InterviewPrepPlan.model_validate_json(row["payload"]) if row else None

    def analytics(self) -> MarketFitAnalytics:
        opportunities = self.opportunities()
        event_map = {
            item.id: [event.stage for event in self.events(item.id)] for item in opportunities
        }
        return build_analytics(self.campaign(), opportunities, event_map)

    def detail(self, opportunity_id: str) -> dict:
        item = self.get_opportunity(opportunity_id)
        return {
            "opportunity": item.model_dump(mode="json"),
            "demands": (
                self.demands(opportunity_id).model_dump(mode="json")
                if self.demands(opportunity_id)
                else None
            ),
            "assessment": (
                self.assessment(opportunity_id).model_dump(mode="json")
                if self.assessment(opportunity_id)
                else None
            ),
            "events": [event.model_dump(mode="json") for event in self.events(opportunity_id)],
            "interview_prep": (
                self.prep(opportunity_id).model_dump(mode="json")
                if self.prep(opportunity_id)
                else None
            ),
        }

    def _opportunity(self, row: sqlite3.Row) -> MarketOpportunity:
        assessment = self.assessment(row["id"])
        demand = self.demands(row["id"])
        events = self.events(row["id"])
        current_stage = events[-1].stage if events else None
        # A late response supersedes ghosting as the current status but keeps the audit event.
        if any(item.stage == FunnelStage.RECRUITER_RESPONSE for item in events):
            progress = [
                stage
                for stage in (
                    FunnelStage.RECRUITER_RESPONSE,
                    FunnelStage.HR_INTERVIEW,
                    FunnelStage.TECHNICAL_INTERVIEW,
                    FunnelStage.OFFER,
                )
                if any(item.stage == stage for item in events)
            ]
            terminal_after_response = [
                item.stage
                for item in events
                if item.stage in {FunnelStage.REJECTED, FunnelStage.WITHDRAWN}
                and item.occurred_at
                >= next(
                    event.occurred_at
                    for event in events
                    if event.stage == FunnelStage.RECRUITER_RESPONSE
                )
            ]
            current_stage = terminal_after_response[-1] if terminal_after_response else progress[-1]
        return MarketOpportunity(
            id=row["id"],
            source_application_id=row["source_application_id"],
            company=row["company"],
            job_title=row["job_title"],
            source_url=row["source_url"],
            source_domain=row["source_domain"],
            description=row["description"],
            track=row["track"],
            application_mode=row["application_mode"],
            resume_file=row["resume_file"],
            applied_at=datetime.fromisoformat(row["applied_at"]) if row["applied_at"] else None,
            employment_type=row["employment_type"],
            job_level=row["job_level"],
            salary_signal=row["salary_signal"],
            salary_monthly_min_php=row["salary_monthly_min_php"],
            salary_monthly_max_php=row["salary_monthly_max_php"],
            salary_band=row["salary_band"],
            current_stage=current_stage,
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
            demand_verified=bool(demand and demand.verified),
            fit_assessment=assessment,
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
                CREATE TABLE IF NOT EXISTS market_fit_campaigns (
                    id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS market_fit_opportunities (
                    id TEXT PRIMARY KEY,
                    source_application_id INTEGER UNIQUE,
                    company TEXT NOT NULL,
                    job_title TEXT NOT NULL,
                    source_url TEXT NOT NULL DEFAULT '',
                    source_domain TEXT NOT NULL DEFAULT '',
                    description TEXT NOT NULL DEFAULT '',
                    track TEXT NOT NULL,
                    application_mode TEXT NOT NULL,
                    resume_file TEXT NOT NULL DEFAULT '',
                    applied_at TEXT,
                    employment_type TEXT NOT NULL DEFAULT '',
                    job_level TEXT NOT NULL DEFAULT 'unknown',
                    salary_signal TEXT NOT NULL DEFAULT '',
                    salary_monthly_min_php INTEGER,
                    salary_monthly_max_php INTEGER,
                    salary_band TEXT NOT NULL DEFAULT 'unknown',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS market_fit_demands (
                    opportunity_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    verified INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(opportunity_id) REFERENCES market_fit_opportunities(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS market_fit_assessments (
                    opportunity_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(opportunity_id) REFERENCES market_fit_opportunities(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS market_fit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    opportunity_id TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    note TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL DEFAULT 'manual',
                    FOREIGN KEY(opportunity_id) REFERENCES market_fit_opportunities(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_market_fit_events_opportunity
                    ON market_fit_events(opportunity_id, occurred_at);
                CREATE TABLE IF NOT EXISTS market_fit_interview_prep (
                    opportunity_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(opportunity_id) REFERENCES market_fit_opportunities(id) ON DELETE CASCADE
                );
                """
            )
            _ensure_columns(
                connection,
                "market_fit_opportunities",
                {
                    "employment_type": "TEXT NOT NULL DEFAULT ''",
                    "job_level": "TEXT NOT NULL DEFAULT 'unknown'",
                    "salary_signal": "TEXT NOT NULL DEFAULT ''",
                    "salary_monthly_min_php": "INTEGER",
                    "salary_monthly_max_php": "INTEGER",
                    "salary_band": "TEXT NOT NULL DEFAULT 'unknown'",
                },
            )


def _ensure_columns(connection: sqlite3.Connection, table: str, columns: dict[str, str]) -> None:
    existing = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
    for name, declaration in columns.items():
        if name not in existing:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")
