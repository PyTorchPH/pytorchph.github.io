from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from resume_builder.core.models import (
    ContactInfo,
    Resume,
    ResumeProject,
    ResumeSkillGroup,
    RoleSpec,
)
from resume_builder.job_application import ApplicationSubmissionHistory
from resume_builder.job_application.market_fit import (
    ApplicationMode,
    FitLevel,
    FunnelEventCreate,
    FunnelStage,
    JobDemandDraft,
    JobDemandProfile,
    MarketFitCampaign,
    MarketFitStore,
    MarketOpportunityCreate,
    MarketOpportunityUpdate,
    MarketTrack,
    assess_fit,
    generate_interview_prep,
)
from resume_builder.job_application.market_fit.models import (
    ConstraintKind,
    EligibilityConstraint,
    InterviewPrepDraft,
    InterviewStory,
    JobRequirement,
    RequirementKind,
)


def _resume() -> Resume:
    return Resume(
        role=RoleSpec(id="automation", label="Automation Engineer"),
        contact=ContactInfo(name="Test Candidate"),
        skill_groups=[ResumeSkillGroup(name="Python", items=["FastAPI", "PyTorch"])],
        projects=[
            ResumeProject(
                name="Application automation",
                description="Built a FastAPI and Playwright application workflow.",
                skill_subtags=["Python", "FastAPI", "Playwright"],
                qualitative_impact=["Reduced repetitive application-form work."],
            )
        ],
    )


def _demands(opportunity_id: str, *, verified: bool = True) -> JobDemandProfile:
    return JobDemandProfile(
        opportunity_id=opportunity_id,
        verified=verified,
        verified_at=datetime.now(timezone.utc) if verified else None,
        requirements=[
            JobRequirement(
                id="req-1",
                kind=RequirementKind.SKILL,
                text="Python FastAPI automation",
                essential=True,
                source_quote="Python and FastAPI required",
                confidence=0.95,
            ),
            JobRequirement(
                id="req-2",
                kind=RequirementKind.SKILL,
                text="Kubernetes operations",
                essential=True,
                source_quote="Kubernetes experience",
                confidence=0.9,
            ),
        ],
        constraints=[
            EligibilityConstraint(
                id="constraint-1",
                kind=ConstraintKind.DEGREE,
                text="Bachelor's degree required",
                value="bachelor degree",
                mandatory=True,
                source_quote="Bachelor's degree required",
                confidence=0.98,
            ),
            EligibilityConstraint(
                id="constraint-2",
                kind=ConstraintKind.WORK_MODE,
                text="Remote",
                value="remote",
                mandatory=True,
                source_quote="Remote",
                confidence=0.98,
            ),
        ],
        confidence=0.92,
    )


def test_campaign_defaults_and_percentage_validation():
    campaign = MarketFitCampaign()

    assert campaign.end_date.isoformat() == "2026-08-24"
    assert campaign.track_mix[MarketTrack.CONTRACT] == 50
    assert campaign.ghost_after_days == 21

    with pytest.raises(ValueError, match="track_mix"):
        MarketFitCampaign(
            track_mix={
                MarketTrack.FULL_TIME: 50,
                MarketTrack.CONTRACT: 50,
                MarketTrack.FREELANCE: 50,
            }
        )


def test_store_is_persistent_and_syncs_confirmed_submissions_idempotently(tmp_path):
    database = tmp_path / "applications.sqlite3"
    history = ApplicationSubmissionHistory(database)
    applied_at = datetime(2026, 8, 4, tzinfo=timezone.utc)
    entry = history.record_existing_submission(
        company="Example AI",
        job_title="Python Automation Engineer",
        applied_at=applied_at,
        source_url="https://au.indeed.com/viewjob?jk=secret",
    )
    store = MarketFitStore(database)

    assert store.sync_confirmed_submissions() == 1
    assert store.sync_confirmed_submissions() == 0

    opportunity = store.opportunities()[0]
    assert opportunity.source_application_id == entry.id
    assert opportunity.source_url == "https://au.indeed.com/viewjob"
    assert opportunity.current_stage == FunnelStage.APPLIED


def test_sync_is_empty_when_submission_history_has_not_been_initialized(tmp_path):
    store = MarketFitStore(tmp_path / "market.sqlite3")

    assert store.sync_confirmed_submissions() == 0


def test_verified_fit_separates_access_evidence_and_preferences(tmp_path):
    store = MarketFitStore(tmp_path / "market.sqlite3")
    opportunity = store.create_opportunity(
        MarketOpportunityCreate(
            company="Example AI",
            job_title="Automation Engineer",
            description="Python FastAPI role",
            track=MarketTrack.CONTRACT,
            application_mode=ApplicationMode.MANUAL_TAILORED,
        )
    )

    assessment = assess_fit(opportunity, _demands(opportunity.id), _resume(), store.campaign())

    assert assessment.eligibility == FitLevel.CONFLICT
    assert assessment.demands_abilities == FitLevel.PARTIAL
    assert assessment.needs_supplies == FitLevel.ALIGNED
    assert assessment.evidence_matches[0].evidence_ids
    assert assessment.evidence_matches[1].status == "missing"


def test_fit_requires_human_verified_demands(tmp_path):
    store = MarketFitStore(tmp_path / "market.sqlite3")
    opportunity = store.create_opportunity(
        MarketOpportunityCreate(company="A", job_title="B", description="Python")
    )

    with pytest.raises(ValueError, match="human-verified"):
        assess_fit(opportunity, _demands(opportunity.id, verified=False), _resume(), store.campaign())


def test_evidence_changes_invalidate_stale_demands_and_assessment(tmp_path):
    store = MarketFitStore(tmp_path / "market.sqlite3")
    opportunity = store.create_opportunity(
        MarketOpportunityCreate(company="A", job_title="B", description="Python")
    )
    demands = _demands(opportunity.id)
    store.approve_demands(
        opportunity.id,
        JobDemandDraft(
            requirements=demands.requirements,
            constraints=demands.constraints,
            confidence=demands.confidence,
        ),
    )
    store.save_assessment(assess_fit(opportunity, demands, _resume(), store.campaign()))

    store.update_opportunity(
        opportunity.id,
        MarketOpportunityUpdate(description="Changed employer requirements"),
    )

    assert store.demands(opportunity.id) is None
    assert store.assessment(opportunity.id) is None


def test_configurable_ghosting_and_late_response_reactivation(tmp_path):
    store = MarketFitStore(tmp_path / "market.sqlite3")
    store.save_campaign(MarketFitCampaign(ghost_after_days=7))
    applied_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
    opportunity = store.create_opportunity(
        MarketOpportunityCreate(
            company="Example",
            job_title="Engineer",
            applied_at=applied_at,
        )
    )

    assert store.apply_ghosting(now=applied_at + timedelta(days=8)) == 1
    assert store.get_opportunity(opportunity.id).current_stage == FunnelStage.GHOSTED

    store.add_event(
        opportunity.id,
        FunnelEventCreate(
            stage=FunnelStage.RECRUITER_RESPONSE,
            occurred_at=applied_at + timedelta(days=10),
        ),
    )

    assert store.get_opportunity(opportunity.id).current_stage == FunnelStage.RECRUITER_RESPONSE
    assert {event.stage for event in store.events(opportunity.id)} >= {
        FunnelStage.GHOSTED,
        FunnelStage.RECRUITER_RESPONSE,
    }


def test_analytics_reports_pending_and_uncertainty(tmp_path):
    store = MarketFitStore(tmp_path / "market.sqlite3")
    applied_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
    responded = store.create_opportunity(
        MarketOpportunityCreate(company="A", job_title="One", applied_at=applied_at)
    )
    store.add_event(responded.id, FunnelEventCreate(stage=FunnelStage.RECRUITER_RESPONSE))
    store.add_event(responded.id, FunnelEventCreate(stage=FunnelStage.REJECTED))
    pending = store.create_opportunity(
        MarketOpportunityCreate(company="B", job_title="Two", applied_at=applied_at)
    )

    analytics = store.analytics()
    first = analytics.conversions[0]

    assert analytics.total_opportunities == 2
    assert first.successes == 1
    assert first.resolved == 1
    assert first.pending == 1
    assert 0 <= first.interval_low < first.interval_high <= 1
    assert first.sufficient_sample is False
    assert "track:contract_project" in analytics.conversion_segments
    assert "mode:automated" in analytics.conversion_segments
    assert pending.id in {item.id for item in store.opportunities()}


def test_direct_technical_invitation_counts_as_response_without_inventing_hr(tmp_path):
    store = MarketFitStore(tmp_path / "market.sqlite3")
    opportunity = store.create_opportunity(
        MarketOpportunityCreate(
            company="Direct",
            job_title="Engineer",
            applied_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        )
    )
    store.add_event(opportunity.id, FunnelEventCreate(stage=FunnelStage.TECHNICAL_INTERVIEW))

    analytics = store.analytics()

    assert analytics.conversions[0].successes == 1
    assert analytics.conversions[1].resolved == 0
    assert FunnelStage.HR_INTERVIEW not in {event.stage for event in store.events(opportunity.id)}


def test_interview_prep_rejects_unknown_evidence_ids():
    class FakeLLM:
        def structured(self, prompt, schema, system=None, max_tokens=2048):
            assert schema is InterviewPrepDraft
            return InterviewPrepDraft(
                competency_themes=["Python automation"],
                stories=[
                    InterviewStory(
                        competency="Python automation",
                        question_theme="Tell me about an automation project",
                        action="Built the workflow",
                        evidence_ids=["invented:99"],
                    )
                ],
            )

    with pytest.raises(ValueError, match="unknown evidence"):
        generate_interview_prep(
            FakeLLM(),
            opportunity_id="opp-1",
            job_title="Automation Engineer",
            demands=_demands("opp-1"),
            resume=_resume(),
        )


def test_job_demand_ids_must_be_unique():
    item = JobRequirement(id="req-1", kind=RequirementKind.SKILL, text="Python")

    with pytest.raises(ValueError, match="unique"):
        JobDemandDraft(requirements=[item, item])
