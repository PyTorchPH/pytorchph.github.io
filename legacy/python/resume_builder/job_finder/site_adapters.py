"""Deterministic search and extraction adapters for explicitly supported job sites.

Known adapters are tried before learned AI rules. A selector/layout mismatch is treated as
layout drift and falls back to the existing access-gated inventory and AI planning path.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from .dom_inventory import fingerprint
from .models import (
    JobListingAction,
    JobListingExtraction,
    JobListingRule,
    JobSearchWorkflow,
    LearnedJobListingLayout,
)
from .rule_executor import _parse, _select


class WorkMode(str, Enum):
    REMOTE = "remote"
    HYBRID = "hybrid"
    ONSITE = "onsite"
    ANY = "any"


class SearchStep(BaseModel):
    action: str
    selector: str
    value: str | None = None
    purpose: str


class SiteSearchPlan(BaseModel):
    site_id: str
    domain: str
    keyword: str
    work_mode: WorkMode
    location: str = ""
    steps: list[SearchStep] = Field(default_factory=list)
    capability_evidence: list[str] = Field(default_factory=list)


class SiteAdapterDriftError(ValueError):
    """The known domain no longer exposes the adapter's required controls."""


@dataclass(frozen=True)
class JobSiteAdapter:
    site_id: str
    host_suffixes: tuple[str, ...]
    keyword_selector: str
    location_selector: str
    submit_selector: str
    work_mode_filter_selector: str | None = None

    def matches(self, page_url: str) -> bool:
        host = (urlsplit(page_url).hostname or "").lower()
        return any(host == suffix or host.endswith(f".{suffix}") for suffix in self.host_suffixes)

    @staticmethod
    def _first(html: str, selector: str):
        root = _parse(html)
        matches = _select(root, selector) if root is not None else []
        return matches[0] if matches else None

    def _require(self, html: str, selector: str, label: str):
        element = self._first(html, selector)
        if element is None:
            raise SiteAdapterDriftError(
                f"{self.site_id} adapter drift: missing {label} selector {selector!r}"
            )
        return element

    def build_search_plan(
        self,
        page_url: str,
        html: str,
        *,
        keyword: str,
        work_mode: WorkMode | str,
        location: str = "",
    ) -> SiteSearchPlan:
        mode = WorkMode(work_mode)
        keyword_value = keyword.strip()
        if not keyword_value:
            raise ValueError("keyword must not be blank")

        self._require(html, self.keyword_selector, "keyword input")
        self._require(html, self.submit_selector, "search submit")
        plan = SiteSearchPlan(
            site_id=self.site_id,
            domain=(urlsplit(page_url).hostname or "").lower(),
            keyword=keyword_value,
            work_mode=mode,
            location=location.strip(),
            steps=[
                SearchStep(
                    action="fill",
                    selector=self.keyword_selector,
                    value=keyword_value,
                    purpose="set the user-approved broad job keyword",
                )
            ],
        )

        if mode == WorkMode.REMOTE and self.site_id == "indeed":
            field = self._require(html, self.location_selector, "location input")
            placeholder = (field.get("placeholder") or "").strip()
            if "remote" not in placeholder.lower():
                raise SiteAdapterDriftError(
                    "indeed adapter drift: location field does not advertise remote support"
                )
            plan.location = "remote"
            plan.capability_evidence.append(f"location placeholder: {placeholder}")
            plan.steps.append(
                SearchStep(
                    action="fill",
                    selector=self.location_selector,
                    value="remote",
                    purpose="use Indeed's advertised remote location value",
                )
            )
        elif mode in {WorkMode.REMOTE, WorkMode.HYBRID}:
            if not self.work_mode_filter_selector:
                raise SiteAdapterDriftError(
                    f"{self.site_id} has no verified deterministic {mode.value} control"
                )
            field = self._require(html, self.work_mode_filter_selector, "work-mode filter")
            options = [
                " ".join(text.strip() for text in option.itertext() if text.strip())
                for option in field.iter("option")
            ]
            wanted = mode.value
            selected = next((option for option in options if wanted in option.lower()), None)
            if not selected:
                raise SiteAdapterDriftError(
                    f"{self.site_id} adapter drift: no {wanted!r} work-mode option"
                )
            plan.capability_evidence.append(f"work-mode option: {selected}")
            plan.steps.append(
                SearchStep(
                    action="select_option",
                    selector=self.work_mode_filter_selector,
                    value=selected,
                    purpose=f"preserve the explicit {wanted} work-mode constraint",
                )
            )
        elif mode == WorkMode.ONSITE:
            if not plan.location:
                raise ValueError("onsite work mode requires an explicit location")
            self._require(html, self.location_selector, "location input")
            plan.steps.append(
                SearchStep(
                    action="fill",
                    selector=self.location_selector,
                    value=plan.location,
                    purpose="set the user-approved onsite location",
                )
            )

        plan.steps.append(
            SearchStep(
                action="click",
                selector=self.submit_selector,
                purpose="submit the reviewed job search",
            )
        )
        return plan

    def build_listing_layout(self, page_url: str, html: str) -> LearnedJobListingLayout:
        if self.site_id == "indeed":
            return _indeed_layout(page_url, html)
        if self.site_id == "jobstreet":
            return _jobstreet_layout(page_url, html)
        raise ValueError(f"unsupported site adapter: {self.site_id}")


def _indeed_layout(page_url: str, html: str) -> LearnedJobListingLayout:
    return LearnedJobListingLayout(
        domain=(urlsplit(page_url).hostname or "").lower(),
        sample_url=page_url,
        layout_fingerprint=fingerprint(html),
        confidence=1.0,
        workflow=JobSearchWorkflow(
            keyword_input_selector="input#text-input-what, input[name=q]",
            location_input_selector="input#text-input-where, input[name=l]",
            submit_search_selector="button.yosegi-InlineWhatWhere-primaryButton",
            detail_navigation_mode="same_page_panel",
            result_item_click_selector="a.jcs-JobTitle",
            detail_panel_selector="div.jobsearch-RightPane",
            detail_loaded_selector="div#jobDescriptionText",
            requires_click_to_reveal_detail=True,
        ),
        rules=[
            JobListingRule(selector="header.gnav, footer", role=JobListingAction.IGNORE),
            JobListingRule(
                selector="div.job_seen_beacon",
                role=JobListingAction.JOB_CARD,
                extract=JobListingExtraction(
                    title="a.jcs-JobTitle, h2.jobTitle, h3.jobTitle",
                    company="span[data-testid=company-name], span.companyName",
                    location="div[data-testid=text-location], div.companyLocation",
                    remote_signal="div[data-testid=text-location], div.companyLocation",
                    salary_signal="li.salary-snippet-container, div.salary-snippet",
                    employment_type="div.job-type",
                    detail_url="a.jcs-JobTitle, a@href",
                    description="div.job-snippet",
                ),
            ),
            JobListingRule(selector="a[aria-label=Next]", role=JobListingAction.NEXT_PAGE),
            JobListingRule(
                selector="input#text-input-what, input#text-input-where, input[name=q], input[name=l]",
                role=JobListingAction.SEARCH_INPUT,
            ),
            JobListingRule(
                selector="button.yosegi-InlineWhatWhere-primaryButton",
                role=JobListingAction.SUBMIT_SEARCH,
            ),
            JobListingRule(selector="a.jcs-JobTitle", role=JobListingAction.OPEN_DETAIL),
            JobListingRule(selector="div.jobsearch-RightPane", role=JobListingAction.DETAIL_PANEL),
        ],
    )


def _jobstreet_layout(page_url: str, html: str) -> LearnedJobListingLayout:
    return LearnedJobListingLayout(
        domain=(urlsplit(page_url).hostname or "").lower(),
        sample_url=page_url,
        layout_fingerprint=fingerprint(html),
        confidence=1.0,
        workflow=JobSearchWorkflow(
            keyword_input_selector="input[name=keywords]",
            location_input_selector="input[name=where]",
            submit_search_selector="button.search-submit",
        ),
        rules=[
            JobListingRule(selector="header.site-header, footer", role=JobListingAction.IGNORE),
            JobListingRule(
                selector="article.job-card",
                role=JobListingAction.JOB_CARD,
                extract=JobListingExtraction(
                    title="a.job-title",
                    company="span.company-name",
                    location="span.job-location",
                    remote_signal="span.work-arrangement",
                    employment_type="span.work-type",
                    detail_url="a.job-title@href",
                    description="p.job-summary",
                ),
            ),
            JobListingRule(selector="a.next-page", role=JobListingAction.NEXT_PAGE),
            JobListingRule(selector="select[name=workType]", role=JobListingAction.FILTER_CONTROL),
            JobListingRule(
                selector="input[name=keywords], input[name=where]",
                role=JobListingAction.SEARCH_INPUT,
            ),
            JobListingRule(selector="button.search-submit", role=JobListingAction.SUBMIT_SEARCH),
        ],
    )


INDEED_ADAPTER = JobSiteAdapter(
    site_id="indeed",
    host_suffixes=("indeed.com",),
    keyword_selector="input#text-input-what, input[name=q]",
    location_selector="input#text-input-where, input[name=l]",
    submit_selector="button.yosegi-InlineWhatWhere-primaryButton",
)

JOBSTREET_ADAPTER = JobSiteAdapter(
    site_id="jobstreet",
    host_suffixes=("jobstreet.com", "jobstreet.com.ph"),
    keyword_selector="input[name=keywords]",
    location_selector="input[name=where]",
    submit_selector="button.search-submit",
    work_mode_filter_selector="select[name=workType]",
)

DEFAULT_SITE_ADAPTERS = (INDEED_ADAPTER, JOBSTREET_ADAPTER)


def resolve_site_adapter(
    page_url: str,
    adapters: tuple[JobSiteAdapter, ...] = DEFAULT_SITE_ADAPTERS,
) -> JobSiteAdapter | None:
    return next((adapter for adapter in adapters if adapter.matches(page_url)), None)
