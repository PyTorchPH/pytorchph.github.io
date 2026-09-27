"""Provider-neutral AI drafting and deterministic evidence validation."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from resume_builder.core.models import Resume
from resume_builder.llm.base import LLMProvider

from ..evidence_context import CareerEvidenceTool
from .models import InterviewPrepDraft, InterviewPrepPlan, JobDemandDraft

_DEMAND_SYSTEM = """You extract employer-stated job demands into strict structured data.
Use only the supplied sanitized posting text. Separate essential from preferred requirements.
Capture explicit eligibility constraints without inferring unstated degree, experience, salary,
authorization, country, work-mode, or employment requirements. Preserve a short source quote for
every item. Stable IDs must be req-1/constraint-1 style. Unknown information belongs in warnings."""

_PREP_SYSTEM = """You prepare truthful employment interviews from supplied verified job demands
and bounded career evidence. Every STAR story must cite one or more supplied evidence IDs. Do not
invent metrics, employers, users, deployment, publications, responsibilities, or outcomes. Leave a
STAR field blank and add a gap when evidence does not support it. Return concise structured data."""


def draft_job_demands(llm: LLMProvider, *, job_title: str, description: str) -> JobDemandDraft:
    if not description.strip():
        raise ValueError("saved job description is required before drafting demands")
    return llm.structured(
        f"Job title: {job_title}\n\nSanitized posting text:\n{description[:30_000]}",
        schema=JobDemandDraft,
        system=_DEMAND_SYSTEM,
        max_tokens=4096,
    )


def generate_interview_prep(
    llm: LLMProvider,
    *,
    opportunity_id: str,
    job_title: str,
    demands: JobDemandDraft,
    resume: Resume,
) -> InterviewPrepPlan:
    evidence_tool = CareerEvidenceTool(resume, max_items=60)
    queries = [item.text for item in demands.requirements]
    evidence = []
    seen: set[str] = set()
    for query in queries:
        for item in evidence_tool.search(query):
            if item.evidence_id not in seen:
                evidence.append(item.model_dump(mode="json"))
                seen.add(item.evidence_id)
    if not evidence:
        raise ValueError("no bounded career evidence matched the verified job demands")
    prompt = (
        f"Job title: {job_title}\n"
        f"Verified demands: {json.dumps(demands.model_dump(mode='json'))}\n"
        f"Allowed career evidence: {json.dumps(evidence)}"
    )
    draft = llm.structured(
        prompt,
        schema=InterviewPrepDraft,
        system=_PREP_SYSTEM,
        max_tokens=4096,
    )
    valid_ids = {item["evidence_id"] for item in evidence}
    for story in draft.stories:
        if not story.evidence_ids or not set(story.evidence_ids).issubset(valid_ids):
            raise ValueError("interview story contains missing or unknown evidence IDs")
        for value in (story.situation, story.task, story.action, story.result):
            if re.search(r"\b(?:estimated|approximately|roughly)\b", value, re.I):
                raise ValueError("interview story contains an estimated claim")
    return InterviewPrepPlan(
        opportunity_id=opportunity_id,
        generated_at=datetime.now(timezone.utc),
        **draft.model_dump(),
    )
