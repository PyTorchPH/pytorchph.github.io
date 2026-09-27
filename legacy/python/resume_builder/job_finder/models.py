from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field, model_validator


class JobListingAction(str, Enum):
    """Actions for job listing discovery only.

    These labels are intentionally separate from the resume scraper's node
    actions and from future application-form fill actions.
    """

    IGNORE = "ignore"
    JOB_CARD = "job_card"
    JOB_DETAIL_LINK = "job_detail_link"
    NEXT_PAGE = "next_page"
    FILTER_CONTROL = "filter_control"
    SEARCH_INPUT = "search_input"
    SUBMIT_SEARCH = "submit_search"
    JOB_DESCRIPTION = "job_description"
    APPLY_LINK = "apply_link"
    SIGN_IN_STATUS = "sign_in_status"
    OPEN_DETAIL = "open_detail"
    DETAIL_PANEL = "detail_panel"
    INTERACT = "interact"


class InteractionStep(BaseModel):
    """One safe, observable SPA interaction before deterministic extraction."""

    step: int
    action: str = "click"
    selector: str
    purpose: str = ""
    wait_for_selector: str | None = None
    expected_change: str = ""
    safe_read_only: bool = True


class JobListingExtraction(BaseModel):
    """Field selectors evaluated relative to one `job_card` node.

    Values are CSS-like selectors supported by the deterministic executor.
    Use `selector@attr` to read an attribute, for example `a@href`.
    """

    title: str | None = None
    company: str | None = None
    location: str | None = None
    remote_signal: str | None = None
    salary_signal: str | None = None
    employment_type: str | None = None
    experience_level: str | None = None
    detail_url: str | None = None
    description: str | None = None
    responsibilities: str | None = None
    requirements: str | None = None
    qualifications: str | None = None
    benefits: str | None = None
    apply_url: str | None = None


class JobSearchWorkflow(BaseModel):
    """Reusable search/navigation guidance for one job site layout."""

    check_signed_in_first: bool = True
    signed_in_selector: str | None = None
    signed_out_selector: str | None = None
    keyword_input_selector: str | None = None
    location_input_selector: str | None = None
    submit_search_selector: str | None = None
    detail_navigation_mode: str = "unknown"
    result_item_click_selector: str | None = None
    detail_panel_selector: str | None = None
    detail_loaded_selector: str | None = None
    requires_click_to_reveal_detail: bool = False
    recommended_search_terms: list[str] = Field(default_factory=list)
    navigation_notes: list[str] = Field(default_factory=list)
    interaction_steps: list[InteractionStep] = Field(default_factory=list)


class JobListingRule(BaseModel):
    selector: str
    role: JobListingAction
    reason: str = ""
    extract: JobListingExtraction | None = None

    @model_validator(mode="after")
    def require_extract_for_job_cards(self) -> "JobListingRule":
        if self.role == JobListingAction.JOB_CARD and self.extract is None:
            raise ValueError("job_card rules must include an extract mapping")
        return self


class LearnedJobListingLayout(BaseModel):
    domain: str
    sample_url: str
    layout_fingerprint: str
    page_type: str = "job_listing_index"
    rules: list[JobListingRule] = Field(default_factory=list)
    include_url_patterns: list[str] = Field(default_factory=list)
    exclude_url_patterns: list[str] = Field(default_factory=list)
    workflow: JobSearchWorkflow = Field(default_factory=JobSearchWorkflow)
    confidence: float = 0.0
    warnings: list[str] = Field(default_factory=list)
    revision: int = 0


class JobListing(BaseModel):
    title: str | None = None
    detail_url: str | None = None
    company: str | None = None
    location: str | None = None
    remote_signal: str | None = None
    salary_signal: str | None = None
    employment_type: str | None = None
    experience_level: str | None = None
    description: str | None = None
    responsibilities: str | None = None
    requirements: str | None = None
    qualifications: str | None = None
    benefits: str | None = None
    apply_url: str | None = None
    source_url: str
    source_selector: str = ""


class JobListingRun(BaseModel):
    page_url: str
    layout_fingerprint: str
    extraction_method: str = "ai_rules"
    listings: list[JobListing] = Field(default_factory=list)
    next_page_urls: list[str] = Field(default_factory=list)
    filter_controls: list[str] = Field(default_factory=list)
    search_controls: list[str] = Field(default_factory=list)
    signed_in_status: str = "unknown"
    workflow: JobSearchWorkflow = Field(default_factory=JobSearchWorkflow)
    learned_layout: LearnedJobListingLayout | None = None
    validation_errors: list[str] = Field(default_factory=list)


class JobScrapeVisualizationArtifact(BaseModel):
    """One inspectable model-planning + deterministic-extraction result."""

    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    source_label: str = "job finder run"
    model_output: LearnedJobListingLayout
    scraping_output: JobListingRun
    rendered_dom: str | None = Field(
        default=None,
        description="Sanitized rendered DOM used only by the local debug visualizer.",
    )
