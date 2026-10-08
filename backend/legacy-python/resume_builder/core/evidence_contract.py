"""Versioned evidence-backed resume contract and deterministic legacy adapter."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Metric(StrictModel):
    name: str
    value: float
    unit: str
    scope: str


class Artifact(StrictModel):
    kind: Literal["report", "raw_result", "source", "presentation", "certificate"]
    locator: str
    contentHash: str | None = None


class Verification(StrictModel):
    verifier: str
    verifiedAt: str | None = None


class Evidence(StrictModel):
    maturity: Literal["unsupported", "documented", "measured", "controlled_measured", "replicated"]
    status: Literal["unverified", "user_verified", "officer_verified"]
    resumeEligible: bool
    method: str
    metrics: list[Metric]
    artifacts: list[Artifact]
    verification: Verification
    limitations: list[str]


class ClaimOutput(StrictModel):
    include: bool
    renderedText: str
    destinations: list[str]
    targetIds: list[str]
    atsKeywords: list[str]


class QualityClassification(StrictModel):
    framework: Literal["ISO/IEC 25010:2023", "ISO/IEC 25023:2016", "local"]
    characteristic: str


class Claim(StrictModel):
    id: str
    claimType: Literal["qualitative", "quantitative"]
    canonicalText: str
    qualityClassifications: list[QualityClassification]
    evidence: Evidence
    output: ClaimOutput

    @model_validator(mode="after")
    def enforce_measurement_gate(self) -> Claim:
        if self.claimType == "quantitative" and not self.evidence.metrics:
            raise ValueError("quantitative claims require numeric metrics")
        if self.evidence.resumeEligible and (
            self.evidence.status == "unverified"
            or self.evidence.maturity not in {"controlled_measured", "replicated"}
            or not self.evidence.metrics
        ):
            raise ValueError(
                "resume-eligible evidence must be verified, controlled-measured, and numeric"
            )
        return self

    def is_renderable_for(self, target_id: str) -> bool:
        return (
            self.output.include
            and target_id in self.output.targetIds
            and self.evidence.resumeEligible
            and self.evidence.status != "unverified"
            and bool(self.evidence.metrics)
        )


class Entry(StrictModel):
    id: str
    section: Literal[
        "summary",
        "skills",
        "experience",
        "projects",
        "education",
        "certifications",
        "awards",
        "publications",
        "volunteer",
    ]
    title: str
    organization: str
    dateLabel: str
    summary: str
    skills: list[str]
    claims: list[Claim]


class Subject(StrictModel):
    name: str
    label: str
    email: str
    location: str
    phone: str | None = None
    url: str | None = None


class Target(StrictModel):
    id: str
    role: str
    keywords: list[str]


class GenerationPolicy(StrictModel):
    quantitativeClaimsRequireEligibleEvidence: Literal[True]
    preserveLimitations: Literal[True]
    requireHumanReviewBeforeExport: Literal[True]


class Metadata(StrictModel):
    createdAt: str
    updatedAt: str
    sources: list[str]


class EvidenceBackedResume(StrictModel):
    schema_uri: str | None = Field(default=None, alias="$schema")
    contract: Literal["evidence-backed-resume/v1"]
    documentId: str
    subject: Subject
    targets: list[Target]
    sectionOrder: list[str]
    entries: list[Entry]
    generationPolicy: GenerationPolicy
    metadata: Metadata
    extensions: dict[str, object] = Field(default_factory=dict)

    @model_validator(mode="after")
    def enforce_identity_references(self) -> EvidenceBackedResume:
        target_ids = {target.id for target in self.targets}
        item_ids = [item.id for item in self.entries]
        item_ids.extend(claim.id for item in self.entries for claim in item.claims)
        if len(item_ids) != len(set(item_ids)):
            raise ValueError("entry and claim IDs must be unique")
        unknown = {
            target_id
            for item in self.entries
            for claim in item.claims
            for target_id in claim.output.targetIds
            if target_id not in target_ids
        }
        if unknown:
            raise ValueError(f"unknown target IDs: {sorted(unknown)}")
        return self

    def renderable_profile(self, target_id: str) -> dict[str, object]:
        selected = [
            item
            for item in self.entries
            if any(claim.is_renderable_for(target_id) for claim in item.claims)
        ]

        def bullets(item: Entry) -> list[str]:
            return [
                claim.output.renderedText
                for claim in item.claims
                if claim.is_renderable_for(target_id)
            ]

        return {
            "fullName": self.subject.name,
            "headline": self.subject.label,
            "email": self.subject.email,
            "location": self.subject.location,
            "summary": " ".join(
                text for item in selected if item.section == "summary" for text in bullets(item)
            ),
            "experience": [
                {
                    "title": item.title,
                    "organization": item.organization,
                    "dateLabel": item.dateLabel,
                    "bullets": bullets(item),
                }
                for item in selected
                if item.section == "experience"
            ],
            "projects": [
                {"title": item.title, "summary": item.summary, "bullets": bullets(item)}
                for item in selected
                if item.section == "projects"
            ],
            "skillGroups": [
                {"name": item.title, "items": item.skills}
                for item in selected
                if item.section == "skills"
            ],
            "education": [
                {"school": item.organization, "program": item.title, "dateLabel": item.dateLabel}
                for item in selected
                if item.section == "education"
            ],
        }
