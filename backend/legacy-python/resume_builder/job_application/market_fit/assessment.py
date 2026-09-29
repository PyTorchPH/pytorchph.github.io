"""Explainable fit assessment and conversion analytics."""

from __future__ import annotations

import math
import re
from collections import Counter
from datetime import datetime, timezone

from resume_builder.core.models import Resume

from ..evidence_context import CareerEvidenceTool
from .models import (
    ConstraintAssessment,
    ConstraintKind,
    ConversionMetric,
    EvidenceMatch,
    FitAssessment,
    FitLevel,
    FunnelStage,
    JobDemandProfile,
    MarketFitAnalytics,
    MarketFitCampaign,
    MarketOpportunity,
    MarketTrack,
)


def assess_fit(
    opportunity: MarketOpportunity,
    demands: JobDemandProfile,
    resume: Resume,
    campaign: MarketFitCampaign,
) -> FitAssessment:
    if not demands.verified:
        raise ValueError("job demands must be human-verified before fit assessment")
    tool = CareerEvidenceTool(resume, max_items=8)
    matches: list[EvidenceMatch] = []
    missing: list[str] = []
    essential_count = 0
    essential_matched = 0
    for requirement in demands.requirements:
        citations = tool.search(requirement.text)
        if requirement.essential:
            essential_count += 1
        if citations:
            if requirement.essential:
                essential_matched += 1
            matches.append(
                EvidenceMatch(
                    requirement_id=requirement.id,
                    status="evidenced",
                    evidence_ids=[item.evidence_id for item in citations],
                    rationale="Matched bounded resume evidence; inspect citations before use.",
                )
            )
        else:
            missing.append(requirement.id)
            matches.append(
                EvidenceMatch(
                    requirement_id=requirement.id,
                    status="missing",
                    rationale="No bounded resume evidence matched this demand.",
                )
            )
    if essential_count == 0:
        demand_level = FitLevel.UNKNOWN
    elif essential_matched == essential_count:
        demand_level = FitLevel.COMPLETE
    elif essential_matched:
        demand_level = FitLevel.PARTIAL
    else:
        demand_level = FitLevel.UNSUBSTANTIATED

    constraint_results = [
        _assess_constraint(
            item.kind,
            item.id,
            item.value or item.text,
            item.mandatory,
            campaign,
            opportunity.track,
        )
        for item in demands.constraints
    ]
    mandatory = [
        item for item, result in zip(demands.constraints, constraint_results) if item.mandatory
    ]
    mandatory_results = [
        result for item, result in zip(demands.constraints, constraint_results) if item.mandatory
    ]
    if any(item.status == FitLevel.CONFLICT for item in mandatory_results):
        eligibility = FitLevel.CONFLICT
    elif mandatory and any(item.status == FitLevel.UNKNOWN for item in mandatory_results):
        eligibility = FitLevel.UNKNOWN
    else:
        eligibility = FitLevel.PASS

    preference_kinds = {
        ConstraintKind.COUNTRY,
        ConstraintKind.WORK_MODE,
        ConstraintKind.EMPLOYMENT_TYPE,
        ConstraintKind.SALARY,
    }
    preference_results = [
        result
        for constraint, result in zip(demands.constraints, constraint_results)
        if constraint.kind in preference_kinds
    ]
    if any(item.status == FitLevel.CONFLICT for item in preference_results):
        needs = FitLevel.CONFLICT
    elif any(item.status == FitLevel.UNKNOWN for item in preference_results):
        needs = FitLevel.MIXED
    else:
        needs = FitLevel.ALIGNED if preference_results else FitLevel.UNKNOWN
    unknowns = [
        item.constraint_id for item in constraint_results if item.status == FitLevel.UNKNOWN
    ]
    return FitAssessment(
        opportunity_id=opportunity.id,
        eligibility=eligibility,
        demands_abilities=demand_level,
        needs_supplies=needs,
        evidence_matches=matches,
        constraint_assessments=constraint_results,
        missing_requirements=missing,
        unknowns=unknowns,
        summary=(
            f"Eligibility {eligibility.value}; demands-abilities {demand_level.value}; "
            f"needs-supplies {needs.value}."
        ),
        assessed_at=datetime.now(timezone.utc),
    )


def _assess_constraint(
    kind: ConstraintKind,
    constraint_id: str,
    value: str,
    mandatory: bool,
    campaign: MarketFitCampaign,
    opportunity_track: MarketTrack,
) -> ConstraintAssessment:
    normalized = value.casefold().strip()
    status = FitLevel.UNKNOWN
    rationale = "No deterministic candidate fact can resolve this constraint."
    if kind in {ConstraintKind.DEGREE, ConstraintKind.GRADUATION}:
        requires_completed = any(term in normalized for term in ("bachelor", "degree", "graduate"))
        if requires_completed and campaign.graduation_status.casefold() in {
            "student",
            "undergraduate",
        }:
            status = FitLevel.CONFLICT if mandatory else FitLevel.MIXED
            rationale = "Posting requires completed education while candidate status is student."
        else:
            status = FitLevel.PASS
            rationale = "No explicit completed-degree conflict was detected."
    elif kind == ConstraintKind.EXPERIENCE_YEARS:
        found = re.search(r"\d+(?:\.\d+)?", normalized)
        if found:
            required = float(found.group())
            status = (
                FitLevel.PASS
                if campaign.professional_experience_years >= required
                else FitLevel.CONFLICT
                if mandatory
                else FitLevel.MIXED
            )
            rationale = (
                f"Candidate has {campaign.professional_experience_years:g} verified professional "
                f"years versus {required:g} requested."
            )
    elif kind == ConstraintKind.WORK_MODE:
        if campaign.preferred_work_mode == "any" or campaign.preferred_work_mode in normalized:
            status, rationale = FitLevel.PASS, "Work mode matches the configured preference."
        elif normalized:
            status, rationale = (
                FitLevel.CONFLICT,
                "Work mode conflicts with the configured preference.",
            )
    elif kind == ConstraintKind.COUNTRY:
        countries = [country.casefold() for country in campaign.target_countries]
        if any(country in normalized for country in countries):
            status, rationale = FitLevel.PASS, "Country matches the campaign target list."
        elif normalized:
            status, rationale = FitLevel.CONFLICT, "Country is outside the campaign target list."
    elif kind == ConstraintKind.WORK_AUTHORIZATION:
        authorized = [country.casefold() for country in campaign.authorized_countries]
        if authorized and any(country in normalized for country in authorized):
            status, rationale = (
                FitLevel.PASS,
                "Authorization is explicitly configured for this country.",
            )
    elif kind == ConstraintKind.EMPLOYMENT_TYPE:
        expected = {
            MarketTrack.FULL_TIME: ("full-time", "full time", "permanent"),
            MarketTrack.CONTRACT: ("contract", "contractor", "fixed-term", "project"),
            MarketTrack.FREELANCE: ("freelance", "project"),
        }
        terms = expected[opportunity_track]
        if any(term in normalized for term in terms):
            status, rationale = (
                FitLevel.PASS,
                "Employment type matches the assigned campaign track.",
            )
        elif normalized:
            status = FitLevel.CONFLICT if mandatory else FitLevel.MIXED
            rationale = "Employment type conflicts with the assigned campaign track."
    elif kind == ConstraintKind.SALARY:
        amount = re.search(r"(?:php|₱)\s*([\d,]+)", normalized, re.I)
        if amount and any(term in normalized for term in ("month", "monthly", "/mo")):
            observed = int(amount.group(1).replace(",", ""))
            status = (
                FitLevel.PASS
                if observed >= campaign.minimum_monthly_salary_php
                else FitLevel.CONFLICT
            )
            rationale = f"Observed PHP monthly salary is {observed:,}."
    return ConstraintAssessment(constraint_id=constraint_id, status=status, rationale=rationale)


def conversion_metric(
    name: str,
    *,
    successes: int,
    resolved: int,
    pending: int,
    minimum_sample: int,
) -> ConversionMetric:
    if resolved <= 0:
        return ConversionMetric(name=name, successes=0, resolved=0, pending=pending)
    rate = successes / resolved
    z = 1.959963984540054
    denominator = 1 + (z * z / resolved)
    center = (rate + z * z / (2 * resolved)) / denominator
    margin = z * math.sqrt((rate * (1 - rate) / resolved) + z * z / (4 * resolved**2)) / denominator
    return ConversionMetric(
        name=name,
        successes=successes,
        resolved=resolved,
        pending=pending,
        rate=rate,
        interval_low=max(0.0, center - margin),
        interval_high=min(1.0, center + margin),
        sufficient_sample=resolved >= minimum_sample,
    )


def build_analytics(
    campaign: MarketFitCampaign,
    opportunities: list[MarketOpportunity],
    event_map: dict[str, list[FunnelStage]],
) -> MarketFitAnalytics:
    stage_sets = {key: set(value) for key, value in event_map.items()}
    conversions = _conversion_metrics(campaign, list(stage_sets.values()))
    track_counts = Counter(item.track.value for item in opportunities)
    mode_counts = Counter(item.application_mode.value for item in opportunities)
    salary_counts = Counter(item.salary_band.value for item in opportunities)
    level_counts = Counter(item.job_level.value for item in opportunities)
    stage_counts = Counter(stage.value for stages in stage_sets.values() for stage in stages)
    stale_count = sum(FunnelStage.GHOSTED in stages for stages in stage_sets.values())
    recommendations = []
    insufficient = [item.name for item in conversions if not item.sufficient_sample]
    if insufficient:
        recommendations.append(
            "Insufficient resolved sample for strategy changes: " + ", ".join(insufficient)
        )
    else:
        weakest = min(conversions, key=lambda item: item.rate if item.rate is not None else 1.0)
        recommendations.append(f"Review the weakest observed transition: {weakest.name}.")
    segments: dict[str, list[ConversionMetric]] = {}
    segment_members: dict[str, list[set[FunnelStage]]] = {}
    for opportunity in opportunities:
        stages = stage_sets.get(opportunity.id, set())
        keys = [
            f"track:{opportunity.track.value}",
            f"mode:{opportunity.application_mode.value}",
            f"salary:{opportunity.salary_band.value}",
            f"level:{opportunity.job_level.value}",
        ]
        if opportunity.fit_assessment is not None:
            fit = opportunity.fit_assessment
            keys.append(
                "fit:"
                f"{fit.eligibility.value}|{fit.demands_abilities.value}|{fit.needs_supplies.value}"
            )
        for key in keys:
            segment_members.setdefault(key, []).append(stages)
    for key, members in segment_members.items():
        segments[key] = _conversion_metrics(campaign, members)
    return MarketFitAnalytics(
        campaign=campaign,
        total_opportunities=len(opportunities),
        track_counts=dict(track_counts),
        application_mode_counts=dict(mode_counts),
        salary_band_counts=dict(salary_counts),
        job_level_counts=dict(level_counts),
        stage_counts=dict(stage_counts),
        conversions=conversions,
        conversion_segments=segments,
        stale_count=stale_count,
        recommendations=recommendations,
    )


def _conversion_metrics(
    campaign: MarketFitCampaign,
    stage_sets: list[set[FunnelStage]],
) -> list[ConversionMetric]:
    terminal = {FunnelStage.REJECTED, FunnelStage.WITHDRAWN, FunnelStage.GHOSTED}

    def reached(stages: set[FunnelStage], stage: FunnelStage) -> bool:
        if stage == FunnelStage.RECRUITER_RESPONSE:
            return bool(
                stages
                & {
                    FunnelStage.RECRUITER_RESPONSE,
                    FunnelStage.HR_INTERVIEW,
                    FunnelStage.TECHNICAL_INTERVIEW,
                    FunnelStage.OFFER,
                }
            )
        return stage in stages

    transitions = [
        ("Application → recruiter response", FunnelStage.APPLIED, FunnelStage.RECRUITER_RESPONSE),
        (
            "Recruiter response → HR interview",
            FunnelStage.RECRUITER_RESPONSE,
            FunnelStage.HR_INTERVIEW,
        ),
        (
            "HR interview → technical interview",
            FunnelStage.HR_INTERVIEW,
            FunnelStage.TECHNICAL_INTERVIEW,
        ),
        ("Technical interview → offer", FunnelStage.TECHNICAL_INTERVIEW, FunnelStage.OFFER),
    ]
    metrics = []
    for name, source, target in transitions:
        source_items = [stages for stages in stage_sets if reached(stages, source)]
        successes = sum(reached(stages, target) for stages in source_items)
        failures = sum(
            bool(stages & terminal) and not reached(stages, target) for stages in source_items
        )
        metrics.append(
            conversion_metric(
                name,
                successes=successes,
                resolved=successes + failures,
                pending=max(0, len(source_items) - successes - failures),
                minimum_sample=campaign.minimum_resolved_sample,
            )
        )
    return metrics
