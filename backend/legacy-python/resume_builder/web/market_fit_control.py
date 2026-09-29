"""Web-facing composition for the local market-fit and interview workspace."""

from __future__ import annotations

from pathlib import Path

from ..job_application import (
    JobDemandDraft,
    MarketFitCampaign,
    MarketFitStore,
    assess_fit,
    draft_job_demands,
    generate_interview_prep,
)
from ..job_application.indeed_smart_apply import load_resume_artifact
from ..llm.base import LLMProvider
from .job_finder_supervisor import DEFAULT_ARTIFACT_DIR, DEFAULT_DATABASE


def store() -> MarketFitStore:
    return MarketFitStore(DEFAULT_DATABASE)


def state() -> dict:
    repository = store()
    return {
        "campaign": repository.campaign().model_dump(mode="json"),
        "analytics": repository.analytics().model_dump(mode="json"),
        "opportunities": [item.model_dump(mode="json") for item in repository.opportunities()],
    }


def update_campaign(value: MarketFitCampaign) -> MarketFitCampaign:
    return store().save_campaign(value)


def draft_demands(opportunity_id: str, llm: LLMProvider):
    repository = store()
    opportunity = repository.get_opportunity(opportunity_id)
    draft = draft_job_demands(
        llm,
        job_title=opportunity.job_title,
        description=opportunity.description,
    )
    return repository.save_demand_draft(opportunity_id, draft)


def approve_demands(opportunity_id: str, value: JobDemandDraft):
    return store().approve_demands(opportunity_id, value)


def assess_opportunity(opportunity_id: str):
    repository = store()
    opportunity = repository.get_opportunity(opportunity_id)
    demands = repository.demands(opportunity_id)
    if demands is None:
        raise ValueError("job demands have not been drafted")
    resume = _load_opportunity_resume(opportunity.resume_file)
    return repository.save_assessment(
        assess_fit(opportunity, demands, resume, repository.campaign())
    )


def prepare_interview(opportunity_id: str, llm: LLMProvider):
    repository = store()
    opportunity = repository.get_opportunity(opportunity_id)
    demands = repository.demands(opportunity_id)
    if demands is None or not demands.verified:
        raise ValueError("human-verified job demands are required before interview preparation")
    resume = _load_opportunity_resume(opportunity.resume_file)
    return repository.save_prep(
        generate_interview_prep(
            llm,
            opportunity_id=opportunity_id,
            job_title=opportunity.job_title,
            demands=demands,
            resume=resume,
        )
    )


def _load_opportunity_resume(filename: str):
    if not filename or Path(filename).name != filename:
        raise ValueError("select a generated role-specific resume before fit analysis")
    pdf_path = DEFAULT_ARTIFACT_DIR / filename
    candidates = [
        pdf_path.with_suffix(".resume.json"),
        pdf_path.with_suffix(".json"),
    ]
    path = next((candidate for candidate in candidates if candidate.is_file()), None)
    if path is None:
        raise ValueError("selected resume evidence JSON is unavailable")
    return load_resume_artifact(path)
