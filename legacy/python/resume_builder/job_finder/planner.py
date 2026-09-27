from __future__ import annotations

from urllib.parse import urlsplit

from resume_builder.llm.base import LLMProvider

from .dom_inventory import build_listing_dom_inventory, fingerprint
from .models import JobListingRun, LearnedJobListingLayout
from .rule_executor import apply_listing_rules
from .site_adapters import DEFAULT_SITE_ADAPTERS, JobSiteAdapter, resolve_site_adapter
from .store import JobListingLayoutStore, JobScrapeArtifactStore
from .visualizer import sanitize_debug_dom

_SYSTEM = """You are the structure-learning component for a job finder.
You observe a rendered DOM inventory for a job search/listing/detail page and emit reusable JSON
rules. Do not extract jobs yourself. Build selectors and extraction instructions that a
deterministic parser can apply every future run for the same domain/layout.

Reasoning order:
1. Check whether the user is signed in or signed out. Emit workflow selectors for that state first.
2. Before extracting, check whether the page is an access-blocked state: CAPTCHA, Cloudflare,
   "Additional Verification Required", "Just a moment", 403/429 message, login-required wall, or
   sign-in modal that prevents reading results. If blocked, do not invent job selectors, do not suggest bypassing
   the blocker, and do not click through it. Emit low confidence, warnings, sign_in_status/access
   notes, and only the visible blocker/sign-in selectors needed for human handoff.
3. Identify whether the page is a search page, a results/listing page, or a job detail page.
4. If it is a search page, identify keyword/location inputs, submit controls, and search terms or
   navigation needed to reach relevant results.
5. If it is a listing/results page, identify whether job definition/details open by normal link
   navigation or by a dynamic SPA interaction. Many job sites require clicking a job
   card/title/text/icon before the job definition/details appear in a same-page detail panel. In
   that case, emit:
   - workflow.detail_navigation_mode = "same_page_panel" or "spa_route"
   - workflow.requires_click_to_reveal_detail = true
   - workflow.result_item_click_selector = the safe read-only selector to click
   - workflow.detail_panel_selector = the panel/container where details appear
   - workflow.detail_loaded_selector = a stable selector proving the detail panel loaded
   - workflow.interaction_steps = ordered click/wait steps, including clickable div/button/tab/
     accordion targets that reveal content without navigation
   Do not treat Apply/Login/Upload/Submit controls as safe detail-opening clicks.
6. If it is a listing/results page, identify job cards and detail-opening links/click targets. The
   job title is useful but not the main objective; the objective is to reach and extract the job
   definition/details.
7. If it is a detail page or same-page detail panel, identify the job definition: description,
   requirements, qualifications, benefits, location/remote signal, employment type, salary signal,
   and apply link if visible.
8. Treat an explicit user work-mode preference (remote, hybrid, onsite, or any) as a filter
   constraint. Map it only to visible controls/options; never silently substitute another mode.

Allowed roles:
- ignore: site chrome/noise/auth/legal/cookie widgets; remove before extraction.
- sign_in_status: visible sign-in/signed-out/signed-in user indicators.
- job_card: one repeated container per job. Must include extract mapping. Prefer mappings that
  capture detail_url and job definition snippets over only the job title.
- next_page: pagination link/button anchor to the next listing page.
- filter_control: visible filters for location, remote, role, level, employment type, salary.
- search_input: keyword/location search inputs.
- submit_search: search submit control.
- job_description: detail page description region, only when current page is a job detail page.
- apply_link: link/button leading from a job detail to an application page.
- open_detail: safe read-only click target that opens a job detail panel or SPA route.
- detail_panel: same-page panel/container that displays the selected job definition.
- interact: safe read-only non-link control (div/button/tab/accordion/expander) required to reveal
  job details. Pair it with an ordered workflow.interaction_steps entry and observable wait target.

Extraction mapping values are selectors relative to each job_card. Use selector@attr for
attributes such as a@href. For detail pages, selectors may target the description/requirements
regions directly. For SPA/list-detail pages, emit both open_detail/detail_panel rules and workflow
selectors so a browser executor can click a listing, wait for details, then parse the panel. Prefer
stable selectors from the inventory. Do not invent selectors.
Return one strict JSON object matching the schema."""


class JobListingPlanner:
    """Learn and replay reusable job-listing extraction rules."""

    def __init__(
        self,
        llm: LLMProvider,
        store: JobListingLayoutStore | None = None,
        artifact_store: JobScrapeArtifactStore | None = None,
        *,
        min_listings: int = 1,
        max_revision_attempts: int = 1,
        site_adapters: tuple[JobSiteAdapter, ...] = DEFAULT_SITE_ADAPTERS,
    ) -> None:
        self.llm = llm
        self.store = store or JobListingLayoutStore()
        self.artifact_store = artifact_store
        if artifact_store is None and self.store.output_dir is not None:
            self.artifact_store = JobScrapeArtifactStore()
        self.min_listings = min_listings
        self.max_revision_attempts = max_revision_attempts
        self.site_adapters = site_adapters

    def plan_page(
        self,
        page_url: str,
        html: str,
        *,
        user_preferences: str = "",
        force_relearn: bool = False,
    ) -> JobListingRun:
        layout_fingerprint = fingerprint(html)
        domain = urlsplit(page_url).netloc.lower()
        adapter = resolve_site_adapter(page_url, self.site_adapters)
        if adapter is not None:
            adapter_layout = adapter.build_listing_layout(page_url, html)
            adapter_run = self._execute(page_url, html, adapter_layout, "site_adapter")
            if not adapter_run.validation_errors:
                adapter_run.learned_layout = adapter_layout
                return self._record(adapter_run, adapter_layout, html)

        cached = None if force_relearn else self.store.get(layout_fingerprint, domain=domain)
        if cached is not None:
            run = self._execute(page_url, html, cached, "ai_rules_cache")
            if not run.validation_errors:
                return self._record(run, cached, html)

        inventory = build_listing_dom_inventory(html, page_url)
        previous = cached
        errors: list[str] = []
        attempts = self.max_revision_attempts + 1
        for revision in range(attempts):
            layout = self._infer_layout(
                page_url=page_url,
                layout_fingerprint=layout_fingerprint,
                inventory=inventory,
                user_preferences=user_preferences,
                previous=previous,
                errors=errors,
                revision=revision,
            )
            run = self._execute(page_url, html, layout, "ai_rules")
            if not run.validation_errors:
                self.store.put(layout)
                run.learned_layout = layout
                return self._record(run, layout, html)
            previous = layout
            errors = run.validation_errors

        run.learned_layout = previous
        return self._record(run, previous, html) if previous is not None else run

    def _record(
        self,
        run: JobListingRun,
        layout: LearnedJobListingLayout,
        html: str,
    ) -> JobListingRun:
        if self.artifact_store is not None:
            self.artifact_store.put(run, layout, rendered_dom=sanitize_debug_dom(html))
        return run

    def _infer_layout(
        self,
        *,
        page_url: str,
        layout_fingerprint: str,
        inventory: str,
        user_preferences: str,
        previous: LearnedJobListingLayout | None,
        errors: list[str],
        revision: int,
    ) -> LearnedJobListingLayout:
        revision_block = ""
        if previous is not None or errors:
            previous_json = previous.model_dump_json(indent=2) if previous is not None else "none"
            revision_block = (
                "\n\nPREVIOUS RULES:\n"
                f"{previous_json}\n"
                "VALIDATION ERRORS:\n- "
                + "\n- ".join(errors)
                + "\nRevise the rule selectors/extraction mappings to fix these errors."
            )
        prompt = (
            f"PAGE URL: {page_url}\n"
            f"LAYOUT FINGERPRINT: {layout_fingerprint}\n"
            f"USER JOB PREFERENCES:\n{user_preferences or '(none supplied)'}\n\n"
            f"JOB LISTING DOM INVENTORY:\n{inventory}"
            f"{revision_block}"
        )
        layout = self.llm.structured(
            prompt,
            schema=LearnedJobListingLayout,
            system=_SYSTEM,
            max_tokens=4096,
        )
        layout.domain = urlsplit(page_url).netloc.lower()
        layout.sample_url = page_url
        layout.layout_fingerprint = layout_fingerprint
        layout.revision = revision
        return layout

    def _execute(
        self,
        page_url: str,
        html: str,
        layout: LearnedJobListingLayout,
        extraction_method: str,
    ) -> JobListingRun:
        listings, next_urls, filters, searches = apply_listing_rules(
            html,
            page_url,
            f"{urlsplit(page_url).scheme}://{urlsplit(page_url).netloc}",
            layout.rules,
        )
        errors: list[str] = []
        if len(listings) < self.min_listings:
            errors.append(
                f"expected at least {self.min_listings} job listing(s), got {len(listings)}"
            )
        if not any(rule.role.value in {"job_card", "job_description"} for rule in layout.rules):
            errors.append("no job_card or job_description rule emitted")
        return JobListingRun(
            page_url=page_url,
            layout_fingerprint=layout.layout_fingerprint,
            extraction_method=extraction_method,
            listings=listings,
            next_page_urls=next_urls,
            filter_controls=filters,
            search_controls=searches,
            signed_in_status=self._signed_in_status(html, layout),
            workflow=layout.workflow,
            learned_layout=layout if extraction_method == "ai_rules" else None,
            validation_errors=errors,
        )

    @staticmethod
    def _signed_in_status(html: str, layout: LearnedJobListingLayout) -> str:
        lowered = html.lower()
        signed_in = layout.workflow.signed_in_selector
        signed_out = layout.workflow.signed_out_selector
        if signed_in and signed_in.lower() in lowered:
            return "signed_in"
        if signed_out and signed_out.lower() in lowered:
            return "signed_out"
        if any(token in lowered for token in ("sign in", "login", "log in")):
            return "signed_out"
        return "unknown"
