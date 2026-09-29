"""Public contracts for research-grounded market-fit and interview tracking."""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator, model_validator

from ..salary_policy import JobLevel, SalaryBand


class MarketTrack(str, Enum):
    FULL_TIME = "full_time"
    CONTRACT = "contract_project"
    FREELANCE = "freelance"


class ApplicationMode(str, Enum):
    AUTOMATED = "automated"
    MANUAL_TAILORED = "manual_tailored"


class FitLevel(str, Enum):
    PASS = "pass"
    COMPLETE = "complete"
    PARTIAL = "partial"
    ALIGNED = "aligned"
    MIXED = "mixed"
    CONFLICT = "conflict"
    UNSUBSTANTIATED = "unsubstantiated"
    UNKNOWN = "unknown"


class FunnelStage(str, Enum):
    APPLIED = "applied"
    RECRUITER_RESPONSE = "recruiter_response"
    HR_INTERVIEW = "hr_interview"
    TECHNICAL_INTERVIEW = "technical_interview"
    OFFER = "offer"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    GHOSTED = "ghosted"


class RequirementKind(str, Enum):
    SKILL = "skill"
    RESPONSIBILITY = "responsibility"
    EDUCATION = "education"
    EXPERIENCE = "experience"
    PORTFOLIO = "portfolio"
    OTHER = "other"


class ConstraintKind(str, Enum):
    DEGREE = "degree"
    GRADUATION = "graduation"
    EXPERIENCE_YEARS = "experience_years"
    WORK_AUTHORIZATION = "work_authorization"
    COUNTRY = "country"
    WORK_MODE = "work_mode"
    EMPLOYMENT_TYPE = "employment_type"
    SALARY = "salary"
    OTHER = "other"


class MarketFitCampaign(BaseModel):
    id: str = "default"
    name: str = "August 24 Market Fit Mission"
    start_date: date = date(2026, 8, 3)
    end_date: date = date(2026, 8, 24)
    track_mix: dict[MarketTrack, int] = Field(
        default_factory=lambda: {
            MarketTrack.FULL_TIME: 30,
            MarketTrack.CONTRACT: 50,
            MarketTrack.FREELANCE: 20,
        }
    )
    application_mode_mix: dict[ApplicationMode, int] = Field(
        default_factory=lambda: {
            ApplicationMode.AUTOMATED: 80,
            ApplicationMode.MANUAL_TAILORED: 20,
        }
    )
    hr_interview_min: int = 5
    hr_interview_max: int = 10
    technical_interview_min: int = 3
    technical_interview_max: int = 5
    offer_target: int = 1
    full_time_daily_min: int = 5
    full_time_daily_max: int = 10
    ghost_after_days: int = 21
    minimum_resolved_sample: int = 10
    target_roles: list[str] = Field(
        default_factory=lambda: [
            "AI Engineer",
            "Python Developer",
            "Automation Engineer",
            "Software Engineer",
            "AI Developer",
            "Backend Developer",
            "Research Assistant",
            "Junior ML Engineer",
            "Data Annotation with Python",
            "LLM Engineer",
            "Prompt Engineer",
            "AI Automation",
        ]
    )
    target_countries: list[str] = Field(default_factory=lambda: ["Philippines"])
    preferred_work_mode: str = "remote"
    minimum_monthly_salary_php: int = 20_000
    aspirational_monthly_salary_php_min: int = 30_000
    aspirational_monthly_salary_php_max: int = 50_000
    graduation_status: str = "student"
    professional_experience_years: float = 0.0
    authorized_countries: list[str] = Field(default_factory=list)
    updated_at: datetime | None = None

    @model_validator(mode="after")
    def validate_configuration(self) -> "MarketFitCampaign":
        if sum(self.track_mix.values()) != 100:
            raise ValueError("track_mix percentages must total 100")
        if sum(self.application_mode_mix.values()) != 100:
            raise ValueError("application_mode_mix percentages must total 100")
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        if self.hr_interview_max < self.hr_interview_min:
            raise ValueError("hr interview maximum must be >= minimum")
        if self.technical_interview_max < self.technical_interview_min:
            raise ValueError("technical interview maximum must be >= minimum")
        if self.full_time_daily_max < self.full_time_daily_min:
            raise ValueError("daily maximum must be >= minimum")
        if self.ghost_after_days < 1:
            raise ValueError("ghost_after_days must be at least 1")
        return self


class JobRequirement(BaseModel):
    id: str
    kind: RequirementKind
    text: str
    essential: bool = True
    source_quote: str = ""
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class EligibilityConstraint(BaseModel):
    id: str
    kind: ConstraintKind
    text: str
    value: str = ""
    mandatory: bool = True
    source_quote: str = ""
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class JobDemandDraft(BaseModel):
    requirements: list[JobRequirement] = Field(default_factory=list)
    constraints: list[EligibilityConstraint] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)

    @field_validator("requirements", "constraints")
    @classmethod
    def unique_ids(cls, value: list[BaseModel]) -> list[BaseModel]:
        ids = [str(getattr(item, "id", "")) for item in value]
        if len(ids) != len(set(ids)):
            raise ValueError("job-demand item IDs must be unique")
        return value


class JobDemandProfile(JobDemandDraft):
    opportunity_id: str
    verified: bool = False
    verified_at: datetime | None = None


class EvidenceMatch(BaseModel):
    requirement_id: str
    status: str = "missing"
    evidence_ids: list[str] = Field(default_factory=list)
    rationale: str = ""


class ConstraintAssessment(BaseModel):
    constraint_id: str
    status: FitLevel
    rationale: str


class FitAssessment(BaseModel):
    opportunity_id: str
    eligibility: FitLevel
    demands_abilities: FitLevel
    needs_supplies: FitLevel
    evidence_matches: list[EvidenceMatch] = Field(default_factory=list)
    constraint_assessments: list[ConstraintAssessment] = Field(default_factory=list)
    missing_requirements: list[str] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)
    summary: str = ""
    assessed_at: datetime


class MarketOpportunityCreate(BaseModel):
    company: str
    job_title: str
    source_url: str = ""
    source_domain: str = ""
    description: str = ""
    track: MarketTrack = MarketTrack.CONTRACT
    application_mode: ApplicationMode = ApplicationMode.AUTOMATED
    resume_file: str = ""
    applied_at: datetime | None = None
    employment_type: str = ""
    job_level: JobLevel = JobLevel.UNKNOWN
    salary_signal: str = ""
    salary_monthly_min_php: int | None = None
    salary_monthly_max_php: int | None = None
    salary_band: SalaryBand = SalaryBand.UNKNOWN

    @field_validator("company", "job_title")
    @classmethod
    def require_identity(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("company and job_title are required")
        return cleaned


class MarketOpportunity(MarketOpportunityCreate):
    id: str
    source_application_id: int | None = None
    current_stage: FunnelStage | None = None
    created_at: datetime
    updated_at: datetime
    demand_verified: bool = False
    fit_assessment: FitAssessment | None = None


class MarketOpportunityUpdate(BaseModel):
    description: str | None = None
    track: MarketTrack | None = None
    application_mode: ApplicationMode | None = None
    resume_file: str | None = None
    employment_type: str | None = None
    job_level: JobLevel | None = None
    salary_signal: str | None = None
    salary_monthly_min_php: int | None = None
    salary_monthly_max_php: int | None = None
    salary_band: SalaryBand | None = None


class FunnelEventCreate(BaseModel):
    stage: FunnelStage
    occurred_at: datetime | None = None
    note: str = ""
    source: str = "manual"


class FunnelEvent(FunnelEventCreate):
    id: int
    opportunity_id: str
    occurred_at: datetime


class InterviewStory(BaseModel):
    competency: str
    question_theme: str
    situation: str = ""
    task: str = ""
    action: str = ""
    result: str = ""
    evidence_ids: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)


class InterviewPrepDraft(BaseModel):
    competency_themes: list[str] = Field(default_factory=list)
    likely_question_themes: list[str] = Field(default_factory=list)
    stories: list[InterviewStory] = Field(default_factory=list)
    preparation_tasks: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class InterviewPrepPlan(InterviewPrepDraft):
    opportunity_id: str
    approved: bool = False
    generated_at: datetime


class ConversionMetric(BaseModel):
    name: str
    successes: int
    resolved: int
    pending: int
    rate: float | None = None
    interval_low: float | None = None
    interval_high: float | None = None
    sufficient_sample: bool = False


class MarketFitAnalytics(BaseModel):
    campaign: MarketFitCampaign
    total_opportunities: int
    track_counts: dict[str, int]
    application_mode_counts: dict[str, int]
    salary_band_counts: dict[str, int] = Field(default_factory=dict)
    job_level_counts: dict[str, int] = Field(default_factory=dict)
    stage_counts: dict[str, int]
    conversions: list[ConversionMetric]
    conversion_segments: dict[str, list[ConversionMetric]] = Field(default_factory=dict)
    stale_count: int = 0
    recommendations: list[str] = Field(default_factory=list)
