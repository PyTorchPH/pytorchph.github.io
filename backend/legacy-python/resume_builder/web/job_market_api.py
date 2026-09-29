"""FastAPI router for provider-neutral job-market analytics."""

from __future__ import annotations

import csv
import io
import os
from typing import Any

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..job_market import JobMarketQuery, JobMarketService

router = APIRouter(prefix="/api/job-market", tags=["job-market"])


class ImportRequest(BaseModel):
    query: JobMarketQuery
    postings: list[dict[str, Any]] = Field(default_factory=list)
    csv_text: str = ""
    source: str = "manual_import"
    dataset_version: str = ""
    geography: str = ""


def _service() -> JobMarketService:
    return JobMarketService()


def _developer_allowed(token: str | None) -> bool:
    expected = os.environ.get("PYTORCH_PH_DEV_API_TOKEN", "").strip()
    return bool(expected) and token == expected


def _application_analytics(summary):
    from .market_fit_control import state as market_fit_state

    try:
        analytics = market_fit_state().get("analytics", {})
    except (OSError, ValueError):
        return summary
    summary.salary_bands = [
        {"band": band, "count": int(count)}
        for band, count in analytics.get("salary_band_counts", {}).items()
    ]
    summary.funnel = list(analytics.get("conversions", []))
    return summary


@router.get("/sources")
def job_market_sources() -> dict[str, Any]:
    return {"sources": [item.model_dump(mode="json") for item in _service().sources()]}


@router.get("/summary")
def job_market_summary(
    countries: str = "Philippines",
    role_family: str = "software",
    work_mode: str = "any",
    days: int = 90,
):
    try:
        query = JobMarketQuery(
            countries=[value.strip() for value in countries.split(",") if value.strip()],
            role_family=role_family,
            work_mode=work_mode,
            days=days,
        )
        return _application_analytics(_service().summary(query)).model_dump(mode="json")
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@router.get("/postings")
def job_market_postings(
    countries: str = "Philippines",
    role_family: str = "software",
    work_mode: str = "any",
    days: int = 90,
):
    try:
        query = JobMarketQuery(
            countries=[value.strip() for value in countries.split(",") if value.strip()],
            role_family=role_family,
            work_mode=work_mode,
            days=days,
        )
        values = _service().postings(query)
        return {
            "sample_size": len(values),
            "postings": [item.model_dump(mode="json") for item in values],
        }
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@router.post("/refresh")
def refresh_job_market(query: JobMarketQuery, x_dev_api_token: str | None = Header(default=None)):
    if not _developer_allowed(x_dev_api_token):
        return JSONResponse({"error": "developer authorization required"}, status_code=403)
    return _application_analytics(_service().summary(query, refresh=True)).model_dump(mode="json")


@router.post("/import")
def import_job_market(request: ImportRequest, x_dev_api_token: str | None = Header(default=None)):
    if not _developer_allowed(x_dev_api_token):
        return JSONResponse({"error": "developer authorization required"}, status_code=403)
    try:
        postings = request.postings or _csv_postings(request)
        count = _service().import_snapshot(
            request.query,
            {
                "postings": postings,
                "metadata": {
                    "source": request.source,
                    "dataset_version": request.dataset_version,
                    "geography": request.geography,
                },
            },
        )
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    return {"imported": count}


def _csv_postings(request: ImportRequest) -> list[dict[str, Any]]:
    if not request.csv_text.strip():
        return []
    rows = []
    for index, row in enumerate(csv.DictReader(io.StringIO(request.csv_text)), start=1):
        skills = [value.strip() for value in str(row.get("skills", "")).split(";") if value.strip()]
        experience = str(row.get("experience_min_years", "")).strip()
        rows.append(
            {
                "id": str(row.get("id", "")).strip() or f"{request.source}:{index}",
                "source": request.source,
                "company": str(row.get("company", "")).strip(),
                "title": str(row.get("title", "")).strip(),
                "country": str(row.get("country", request.geography)).strip(),
                "work_mode": str(row.get("work_mode", "unknown")).strip() or "unknown",
                "skills": skills,
                "degree_requirement": str(row.get("degree_requirement", "unknown")).strip()
                or "unknown",
                "experience_min_years": float(experience) if experience else None,
                "posted_at": str(row.get("posted_at", "")).strip(),
                "source_url": str(row.get("source_url", "")).strip(),
                "evidence_text": str(row.get("evidence_text", "")).strip(),
            }
        )
    return rows
