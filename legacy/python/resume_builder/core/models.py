"""Domain models shared across every pipeline stage.

These pydantic models are the canonical contracts between stages. Static and AI
implementations must both produce/consume the same shapes — that decoupling is what
lets the orchestrator swap stages by mode without conditional plumbing.
"""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Mode(str, Enum):
    AI = "ai"
    STATIC = "static"


class DocumentType(str, Enum):
    PDF = "pdf"
    DOCX = "docx"
    MD = "md"
    TXT = "txt"
    TEX = "tex"
    OTHER = "other"


class RoleSpec(BaseModel):
    """Target role description — produced by RolePicker, consumed by Extractor + Synthesizer."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., description="Stable identifier, kebab-case.")
    label: str
    keywords: list[str] = Field(default_factory=list)
    must_have_skills: list[str] = Field(default_factory=list)
    nice_to_have: list[str] = Field(default_factory=list)
    summary_hint: str | None = Field(
        default=None,
        description="Optional one-line direction for resume summary tone/angle.",
    )


class Repo(BaseModel):
    """Normalized GitHub repo metadata. Source-agnostic."""

    model_config = ConfigDict(extra="ignore")

    name: str
    full_name: str
    url: str
    description: str | None = None
    languages: list[str] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    readme: str | None = None
    stars: int = 0
    archived: bool = False


class RawDocument(BaseModel):
    path: str
    filename: str
    doc_type: DocumentType
    text: str


class Evidence(BaseModel):
    """One unit of role-relevance signal extracted from a source."""

    source_kind: Literal["repo", "document", "social"]
    source_id: str = Field(..., description="Repo full_name or document filename.")
    snippet: str = ""
    matched_terms: list[str] = Field(default_factory=list)
    score: float = 0.0
    rationale: str | None = None
    bullets: list[str] = Field(default_factory=list)


class ContactInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = ""
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    website: str | None = None
    github: str | None = None
    linkedin: str | None = None
    facebook: str | None = None


class ResumeProject(BaseModel):
    name: str
    url: str | None = None
    description: str = ""
    bullets: list[str] = Field(default_factory=list)
    tech: list[str] = Field(default_factory=list)
    industry_tags: list[str] = Field(default_factory=list)
    skill_subtags: list[str] = Field(default_factory=list)
    quantitative_impact: list[str] = Field(default_factory=list)
    qualitative_impact: list[str] = Field(default_factory=list)
    source_icon: str | None = Field(
        default=None,
        description="Renderer hint for compact source display, e.g. github.",
    )
    display_url: str | None = Field(
        default=None,
        description="Compact human-facing link text such as github/owner/repo.",
    )


class ResumeExperience(BaseModel):
    role: str
    company: str = ""
    location: str | None = None
    start: str | None = None
    end: str | None = None
    bullets: list[str] = Field(default_factory=list)


class ResumeEducation(BaseModel):
    school: str
    degree: str | None = None
    field: str | None = None
    start: str | None = None
    end: str | None = None
    notes: list[str] = Field(default_factory=list)


class ResumeCertification(BaseModel):
    name: str
    issuer: str | None = None
    date: str | None = None
    url: str | None = None


class ResumeAchievement(BaseModel):
    """A noteworthy accomplishment surfaced from social signals or documents."""

    model_config = ConfigDict(extra="ignore")

    title: str
    source: str = Field(..., description="Vendor or origin label, e.g. 'facebook' or 'github'.")
    url: str | None = None
    date: str | None = None
    snippet: str = ""
    industry_tags: list[str] = Field(default_factory=list)
    skill_subtags: list[str] = Field(default_factory=list)
    quantitative_impact: list[str] = Field(default_factory=list)
    qualitative_impact: list[str] = Field(default_factory=list)
    source_icon: str | None = None
    display_url: str | None = None


class ResumeSkillGroup(BaseModel):
    """Display hierarchy: language/platform parent -> evidenced libraries/frameworks."""

    name: str
    items: list[str] = Field(default_factory=list)


class ResumeAcademicHighlight(BaseModel):
    label: str
    value: str
    source: str = "feu-tech-solar"
    verified_at: str = ""


class Resume(BaseModel):
    """Canonical resume model. All renderers consume exactly this."""

    model_config = ConfigDict(extra="forbid")

    role: RoleSpec
    contact: ContactInfo = Field(default_factory=ContactInfo)
    summary: str = ""
    skills: list[str] = Field(default_factory=list)
    skill_groups: list[ResumeSkillGroup] = Field(default_factory=list)
    experience: list[ResumeExperience] = Field(default_factory=list)
    projects: list[ResumeProject] = Field(default_factory=list)
    education: list[ResumeEducation] = Field(default_factory=list)
    certifications: list[ResumeCertification] = Field(default_factory=list)
    achievements: list[ResumeAchievement] = Field(default_factory=list)
    academic_highlights: list[ResumeAcademicHighlight] = Field(default_factory=list)
    generated_on: date = Field(default_factory=date.today)
