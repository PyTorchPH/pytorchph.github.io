"""Compose live, cached, and explicitly synthetic job-market evidence."""

from __future__ import annotations

import hashlib
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any

import requests

from .models import JobMarketQuery, JobMarketSummary, MarketPosting, SourceStatus
from .providers import AdzunaProvider, ProviderUnavailable, RemotiveProvider
from .store import JobMarketSnapshotStore

DEFAULT_MARKET_DB = Path(
    os.environ.get("JOB_MARKET_DATABASE", "var/state/job-market/job-market.sqlite3")
)


class JobMarketService:
    def __init__(self, database: Path = DEFAULT_MARKET_DB) -> None:
        self.store = JobMarketSnapshotStore(database)

    def sources(self) -> list[SourceStatus]:
        return [
            SourceStatus(
                id="adzuna",
                label="Adzuna",
                kind="live_api",
                configured=bool(
                    os.environ.get("ADZUNA_APP_ID") and os.environ.get("ADZUNA_APP_KEY")
                ),
                geography="Supported countries",
                freshness="Live when configured",
                attribution_url="https://developer.adzuna.com/overview",
            ),
            SourceStatus(
                id="remotive",
                label="Remotive",
                kind="live_api",
                configured=True,
                geography="Global remote",
                freshness="Public feed delayed by 24 hours",
                attribution_url="https://remotive.com/remote-jobs/api",
                note="Listings must link back to Remotive.",
            ),
            SourceStatus(
                id="stackoverflow",
                label="Stack Overflow Developer Survey",
                kind="annual_dataset",
                configured=False,
                geography="Global respondents",
                freshness="Annual import",
                attribution_url="https://survey.stackoverflow.co/",
            ),
            SourceStatus(
                id="onet",
                label="O*NET",
                kind="official_series",
                configured=False,
                geography="United States occupations",
                freshness="Versioned taxonomy",
                attribution_url="https://services.onetcenter.org/",
            ),
            SourceStatus(
                id="bls",
                label="BLS / JOLTS",
                kind="official_series",
                configured=False,
                geography="United States",
                freshness="Monthly series",
                attribution_url="https://www.bls.gov/developers/home.htm",
            ),
            SourceStatus(
                id="import",
                label="Versioned CSV/JSON imports",
                kind="import",
                configured=True,
                geography="Declared by the imported snapshot",
                freshness="Explicit import timestamp",
                attribution_url="",
                note="Imported datasets retain their declared source and version metadata.",
            ),
        ]

    def summary(self, query: JobMarketQuery, *, refresh: bool = False) -> JobMarketSummary:
        postings, kinds, warnings = self._collect(query, refresh=refresh)
        return _summarize(
            query,
            postings,
            self.sources(),
            _snapshot_kind(kinds),
            warnings,
            evidenced=_evidenced_skills(),
        )

    def postings(self, query: JobMarketQuery) -> list[MarketPosting]:
        postings, _kinds, _warnings = self._collect(query, refresh=False)
        return postings

    def _collect(
        self, query: JobMarketQuery, *, refresh: bool
    ) -> tuple[list[MarketPosting], list[str], list[str]]:
        key = _query_key(query)
        postings: list[MarketPosting] = []
        kinds: list[str] = []
        warnings: list[str] = []
        imported = self.store.load(key=key, source="import")
        if imported:
            postings.extend(
                MarketPosting.model_validate(item) for item in imported["payload"]["postings"]
            )
            kinds.append("cached")
        for provider in (AdzunaProvider(), RemotiveProvider()):
            cached = self.store.load(key=key, source=provider.id)
            if refresh:
                try:
                    values = provider.fetch(query)
                    payload = {"postings": [item.model_dump(mode="json") for item in values]}
                    self.store.save(key=key, source=provider.id, kind="live", payload=payload)
                    postings.extend(values)
                    kinds.append("live")
                    continue
                except (ProviderUnavailable, requests.RequestException, OSError, ValueError) as exc:
                    warnings.append(f"{provider.id}: {exc}")
            if cached:
                postings.extend(
                    MarketPosting.model_validate(item) for item in cached["payload"]["postings"]
                )
                kinds.append("cached")
            elif not refresh:
                warnings.append(
                    f"{provider.id}: no cached snapshot; controlled backend refresh required"
                )
        if not postings:
            postings = _demo_postings(query)
            kinds.append("synthetic_demo")
            warnings.append(
                "No compatible live or cached posting snapshot; synthetic demo data is displayed."
            )
        postings = _deduplicate(postings)
        if query.work_mode != "any":
            postings = [item for item in postings if item.work_mode == query.work_mode]
        return postings, kinds, warnings

    def import_snapshot(self, query: JobMarketQuery, payload: dict[str, Any]) -> int:
        postings = [MarketPosting.model_validate(item) for item in payload.get("postings", [])]
        if not postings:
            raise ValueError("import requires at least one valid posting")
        self.store.save(
            key=_query_key(query),
            source="import",
            kind="cached",
            payload={
                "postings": [item.model_dump(mode="json") for item in postings],
                "metadata": payload.get("metadata", {}),
            },
        )
        return len(postings)


def _summarize(
    query: JobMarketQuery,
    postings: list[MarketPosting],
    sources: list[SourceStatus],
    kind: str,
    warnings: list[str],
    evidenced: set[str],
) -> JobMarketSummary:
    skills = Counter(skill for item in postings for skill in item.skills)
    modes_by_country: dict[str, Counter[str]] = {}
    for item in postings:
        modes_by_country.setdefault(item.country, Counter())[item.work_mode] += 1
    degree = Counter(item.degree_requirement for item in postings)
    experience = Counter(
        "unknown"
        if item.experience_min_years is None
        else "0–1 years"
        if item.experience_min_years <= 1
        else "2+ years"
        for item in postings
    )
    top_skills = skills.most_common(10)
    if not evidenced:
        warnings.append(
            "No normalized career profile was configured; personal evidence matches are unavailable."
        )
    return JobMarketSummary(
        query=query,
        snapshot_kind=kind,
        sample_size=len(postings),
        unknown_degree_count=degree["unknown"],
        unknown_experience_count=experience["unknown"],
        sources=sources,
        hiring_layoff_series=[
            {
                "period": "Current snapshot",
                "active_postings": len(postings),
                "layoffs": None,
                "geography": ", ".join(query.countries),
            },
        ],
        skill_demand=[
            {"skill": skill, "postings": count, "evidenced": skill in evidenced}
            for skill, count in top_skills
        ],
        qualification_barriers=[
            {
                "label": "Completed degree required",
                "count": degree["completed"],
                "percent": _percent(degree["completed"], len(postings)),
            },
            {
                "label": "Degree requirement unknown",
                "count": degree["unknown"],
                "percent": _percent(degree["unknown"], len(postings)),
            },
            {
                "label": "2+ years experience",
                "count": experience["2+ years"],
                "percent": _percent(experience["2+ years"], len(postings)),
            },
            {
                "label": "Experience requirement unknown",
                "count": experience["unknown"],
                "percent": _percent(experience["unknown"], len(postings)),
            },
        ],
        geography_ratios=[
            {
                "country": country,
                "mode": mode,
                "count": count,
                "percent": _percent(count, sum(values.values())),
            }
            for country, values in modes_by_country.items()
            for mode, count in values.items()
        ],
        personal_comparison=[
            {"skill": skill, "postings": count, "evidenced": skill in evidenced}
            for skill, count in top_skills
        ],
        warnings=[
            *warnings,
            "Hiring and layoff values are descriptive series with different coverage; no causal relationship is inferred.",
            "Personal comparison currently uses the local verified-profile adapter and never infers unevidenced skills.",
        ],
    )


def _demo_postings(query: JobMarketQuery) -> list[MarketPosting]:
    rows = [
        ("Junior Software Engineer", "Python FastAPI SQL Git", "remote"),
        ("Frontend Developer", "TypeScript React Next.js Git", "hybrid"),
        ("Machine Learning Intern", "Python PyTorch Docker", "onsite"),
        ("Backend Engineer", "Python Django PostgreSQL AWS", "remote"),
        ("Cloud Developer", "TypeScript AWS Docker Kubernetes", "hybrid"),
    ]
    values = []
    for country in query.countries:
        for index, (title, evidence, mode) in enumerate(rows):
            values.append(
                MarketPosting(
                    id=f"demo:{country}:{index}",
                    source="synthetic_demo",
                    company="Example employer",
                    title=title,
                    country=country,
                    work_mode=mode,
                    skills=evidence.split(),
                    posted_at="2026-08-01",
                    evidence_text=evidence,
                    degree_requirement="unknown",
                    experience_min_years=None,
                )
            )
    return values


def _evidenced_skills() -> set[str]:
    configured = os.environ.get("JOB_MARKET_PROFILE_JSON", "").strip()
    if configured:
        path = Path(configured)
    else:
        artifact_dir = Path(os.environ.get("JOB_FINDER_ARTIFACT_DIR", "out/application-resumes"))
        path = artifact_dir / "user_profile.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    return {
        str(value).strip()
        for value in payload.get("skills", [])
        if isinstance(value, str) and value.strip()
    }


def _query_key(query: JobMarketQuery) -> str:
    encoded = json.dumps(query.model_dump(mode="json"), sort_keys=True)
    return hashlib.sha256(encoded.encode()).hexdigest()


def _deduplicate(values: list[MarketPosting]) -> list[MarketPosting]:
    result: dict[str, MarketPosting] = {}
    for item in values:
        key = item.id or f"{item.company}|{item.title}|{item.country}".casefold()
        result.setdefault(key, item)
    return list(result.values())


def _snapshot_kind(kinds: list[str]) -> str:
    if "live" in kinds:
        return "live"
    if "cached" in kinds:
        return "cached"
    return "synthetic_demo"


def _percent(value: int, total: int) -> float:
    return round(value * 100 / total, 1) if total else 0.0
