"""Settings and bounded product calls for the local model boundary."""

from __future__ import annotations

import ipaddress
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from ..llm.base import LLMUnavailableError
from ..llm.local_config import (
    PROVIDER_CATALOG,
    LocalAIConfigInput,
    get_configured_provider,
    local_ai_status,
    save_local_ai_config,
)


def _require_loopback(request: Request) -> None:
    host = request.client.host if request.client else ""
    try:
        local = ipaddress.ip_address(host).is_loopback
    except ValueError:
        local = host in {"localhost", "testclient"}
    if not local:
        raise HTTPException(status_code=403, detail="Local AI configuration is loopback-only.")


router = APIRouter(
    prefix="/api/local-ai",
    tags=["local-ai"],
    dependencies=[Depends(_require_loopback)],
)


class UpskillEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=300)
    description: str = Field(default="", max_length=3000)
    skills: list[str] = Field(default_factory=list, max_length=30)


class UpskillRequest(BaseModel):
    evidence: list[UpskillEvidence] = Field(min_length=1, max_length=30)


class UpskillRecommendation(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    focus_skill: str = Field(alias="focusSkill", min_length=1, max_length=120)
    rationale: str = Field(min_length=10, max_length=600)
    next_step: str = Field(alias="nextStep", min_length=5, max_length=400)
    evidence_ids: list[str] = Field(alias="evidenceIds", min_length=1, max_length=10)


class UpskillPlan(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    summary: str = Field(min_length=10, max_length=800)
    recommendations: list[UpskillRecommendation] = Field(min_length=1, max_length=5)
    warnings: list[str] = Field(default_factory=list, max_length=10)


@router.get("/status")
def api_local_ai_status() -> dict[str, object]:
    return local_ai_status()


@router.get("/providers")
def api_local_ai_providers() -> dict[str, object]:
    return {"middleware": "litellm", "providers": PROVIDER_CATALOG}


@router.post("/settings")
def api_save_local_ai_settings(request: LocalAIConfigInput):
    try:
        save_local_ai_config(request)
        return local_ai_status()
    except (OSError, ValueError) as exc:
        return JSONResponse({"error": str(exc)}, status_code=422)


@router.post("/test")
def api_test_local_ai():
    try:
        provider = get_configured_provider()
        reply = provider.complete(
            "Reply with exactly READY.",
            system="This is a configuration health check. Do not include any other text.",
            max_tokens=8,
        )
        return {"ok": bool(reply.strip()), "provider": provider.name, "response": reply.strip()[:80]}
    except Exception as exc:  # provider/network errors are safe, bounded setup feedback
        return JSONResponse({"error": f"AI connection test failed: {exc}"}, status_code=502)


@router.post("/upskill")
def api_generate_upskill_plan(request: UpskillRequest):
    try:
        provider = get_configured_provider()
        allowed_ids = {item.id for item in request.evidence}
        plan = provider.structured(
            "Create a small upskilling plan using only this verified evidence. "
            "Every recommendation must cite one or more supplied evidence IDs. "
            "Do not infer proficiency, employment, grades, or unstated metrics.\n\n"
            + json.dumps([item.model_dump() for item in request.evidence], ensure_ascii=False),
            schema=UpskillPlan,
            system="You are the local UpSkill planning stage. Evidence grounding is mandatory.",
            max_tokens=1200,
        )
        unknown = sorted(
            {
                evidence_id
                for recommendation in plan.recommendations
                for evidence_id in recommendation.evidence_ids
                if evidence_id not in allowed_ids
            }
        )
        if unknown:
            raise ValueError(f"Model cited unknown evidence IDs: {', '.join(unknown)}")
        return plan.model_dump(mode="json", by_alias=True)
    except LLMUnavailableError as exc:
        return JSONResponse({"error": str(exc), "setupRequired": True}, status_code=409)
    except Exception as exc:
        return JSONResponse({"error": f"UpSkill planning failed: {exc}"}, status_code=422)
