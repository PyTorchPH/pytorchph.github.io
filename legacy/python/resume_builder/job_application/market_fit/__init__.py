"""Research-grounded market-fit validation and interview preparation."""

from .assessment import assess_fit, build_analytics, conversion_metric
from .models import (
    ApplicationMode,
    ConstraintKind,
    FitAssessment,
    FitLevel,
    FunnelEvent,
    FunnelEventCreate,
    FunnelStage,
    InterviewPrepDraft,
    InterviewPrepPlan,
    JobDemandDraft,
    JobDemandProfile,
    MarketFitAnalytics,
    MarketFitCampaign,
    MarketOpportunity,
    MarketOpportunityCreate,
    MarketOpportunityUpdate,
    MarketTrack,
)
from .planners import draft_job_demands, generate_interview_prep
from .store import MarketFitStore

__all__ = [
    "ApplicationMode", "ConstraintKind", "FitAssessment", "FitLevel", "FunnelEvent",
    "FunnelEventCreate", "FunnelStage", "InterviewPrepDraft", "InterviewPrepPlan",
    "JobDemandDraft", "JobDemandProfile", "MarketFitAnalytics", "MarketFitCampaign",
    "MarketFitStore", "MarketOpportunity", "MarketOpportunityCreate", "MarketOpportunityUpdate",
    "MarketTrack",
    "assess_fit", "build_analytics", "conversion_metric", "draft_job_demands",
    "generate_interview_prep",
]
