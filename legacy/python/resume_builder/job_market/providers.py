"""Bounded external providers for job-market evidence."""

from __future__ import annotations

import os
import re

import requests

from .models import JobMarketQuery, MarketPosting


class ProviderUnavailable(RuntimeError):
    """The provider is not configured or did not return usable data."""


class AdzunaProvider:
    id = "adzuna"

    def fetch(self, query: JobMarketQuery) -> list[MarketPosting]:
        app_id = os.environ.get("ADZUNA_APP_ID", "").strip()
        app_key = os.environ.get("ADZUNA_APP_KEY", "").strip()
        if not app_id or not app_key:
            raise ProviderUnavailable("Adzuna credentials are not configured")
        country_codes = {
            "australia": "au",
            "canada": "ca",
            "germany": "de",
            "india": "in",
            "new zealand": "nz",
            "singapore": "sg",
            "united kingdom": "gb",
            "united states": "us",
        }
        postings: list[MarketPosting] = []
        for country in query.countries:
            code = country_codes.get(country.casefold())
            if not code:
                continue
            response = requests.get(
                f"https://api.adzuna.com/v1/api/jobs/{code}/search/1",
                params={
                    "app_id": app_id,
                    "app_key": app_key,
                    "what": query.role_family,
                    "results_per_page": 50,
                    "content-type": "application/json",
                },
                timeout=15,
            )
            response.raise_for_status()
            for item in response.json().get("results", []):
                title = str(item.get("title", "")).strip()
                company = str((item.get("company") or {}).get("display_name", "Unknown"))
                identifier = str(item.get("id", "")).strip()
                if not title or not identifier:
                    continue
                description = str(item.get("description", ""))
                postings.append(
                    MarketPosting(
                        id=f"adzuna:{identifier}",
                        source="adzuna",
                        company=company,
                        title=title,
                        country=country,
                        work_mode=_work_mode(description),
                        skills=_skills(description),
                        degree_requirement=_degree(description),
                        experience_min_years=_experience(description),
                        posted_at=str(item.get("created", "")),
                        source_url=str(item.get("redirect_url", "")),
                        evidence_text=description[:1000],
                    )
                )
        if not postings:
            raise ProviderUnavailable("Adzuna returned no compatible country results")
        return postings


class RemotiveProvider:
    id = "remotive"

    def fetch(self, query: JobMarketQuery) -> list[MarketPosting]:
        response = requests.get(
            "https://remotive.com/api/remote-jobs",
            params={"search": query.role_family, "limit": 100},
            timeout=15,
        )
        response.raise_for_status()
        postings = []
        for item in response.json().get("jobs", []):
            description = str(item.get("description", ""))
            location = str(item.get("candidate_required_location", "Worldwide"))
            if not _country_matches(location, query.countries):
                continue
            postings.append(
                MarketPosting(
                    id=f"remotive:{item.get('id')}",
                    source="remotive",
                    company=str(item.get("company_name", "Unknown")),
                    title=str(item.get("title", "Unknown role")),
                    country=location,
                    work_mode="remote",
                    skills=_skills(description),
                    degree_requirement=_degree(description),
                    experience_min_years=_experience(description),
                    posted_at=str(item.get("publication_date", "")),
                    source_url=str(item.get("url", "")),
                    evidence_text=description[:1000],
                )
            )
        if not postings:
            raise ProviderUnavailable("Remotive returned no jobs matching the selected countries")
        return postings


def _country_matches(location: str, countries: list[str]) -> bool:
    normalized = location.casefold()
    return "worldwide" in normalized or any(
        country.casefold() in normalized for country in countries
    )


def _work_mode(text: str) -> str:
    lowered = text.casefold()
    if "hybrid" in lowered:
        return "hybrid"
    if "remote" in lowered:
        return "remote"
    if "on-site" in lowered or "onsite" in lowered:
        return "onsite"
    return "unknown"


def _skills(text: str) -> list[str]:
    catalog: dict[str, str] = {
        "python": "Python",
        "typescript": "TypeScript",
        "javascript": "JavaScript",
        "react": "React",
        "next.js": "Next.js",
        "fastapi": "FastAPI",
        "django": "Django",
        "pytorch": "PyTorch",
        "tensorflow": "TensorFlow",
        "sql": "SQL",
        "postgresql": "PostgreSQL",
        "aws": "AWS",
        "azure": "Azure",
        "docker": "Docker",
        "kubernetes": "Kubernetes",
        "git": "Git",
    }
    lowered = text.casefold()
    return [label for token, label in catalog.items() if token in lowered]


def _degree(text: str) -> str:
    lowered = text.casefold()
    if any(
        term in lowered
        for term in ("degree in progress", "currently pursuing", "final-year student")
    ):
        return "in_progress_ok"
    if any(
        term in lowered for term in ("bachelor's degree", "bachelors degree", "completed degree")
    ):
        return "completed"
    if any(term in lowered for term in ("no degree required", "degree not required")):
        return "not_required"
    return "unknown"


def _experience(text: str) -> float | None:
    match = re.search(
        r"\b(\d+(?:\.\d+)?)\s*(?:\+\s*)?years?(?:\s+of)?\s+(?:professional\s+)?experience\b",
        text,
        re.IGNORECASE,
    )
    return float(match.group(1)) if match else None
