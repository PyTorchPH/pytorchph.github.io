from __future__ import annotations

import json

from resume_builder.job_finder import (
    JobListingAction,
    JobListingExtraction,
    JobListingLayoutStore,
    JobScrapeArtifactStore,
    JobListingPlanner,
    JobListingRule,
    JobSearchWorkflow,
    LearnedJobListingLayout,
    apply_listing_rules,
    build_listing_dom_inventory,
    fingerprint,
    render_rule_overlay,
    sanitize_debug_dom,
)

_LISTINGS = """
<html><body>
  <header class="topbar"><a href="/login">Login</a></header>
  <form class="job-search">
    <label for="q">Keyword</label><input id="q" name="q" type="search" placeholder="Search jobs">
    <label for="loc">Location</label><input id="loc" name="location" placeholder="Location">
    <select name="remote"><option>Any</option><option>Remote</option><option>On-site</option></select>
    <button class="search-button" type="submit">Search</button>
  </form>
  <main class="jobs">
    <article class="job-card">
      <a class="job-title" href="/jobs/backend-engineer">Backend Engineer</a>
      <span class="company">Acme Labs</span>
      <span class="location">Remote - Philippines</span>
      <span class="type">Full-time</span>
      <p class="summary">Build APIs and internal tools.</p>
    </article>
    <article class="job-card">
      <a class="job-title" href="/jobs/ml-engineer">ML Engineer</a>
      <span class="company">Acme Labs</span>
      <span class="location">Makati</span>
      <span class="type">Hybrid</span>
      <p class="summary">Train and evaluate models.</p>
    </article>
    <nav class="pagination"><a class="next" href="/jobs?page=2">Next</a></nav>
  </main>
  <footer>Privacy and boilerplate</footer>
</body></html>
"""

_LISTINGS_PAGE_2 = _LISTINGS.replace("Backend Engineer", "Platform Engineer").replace(
    "/jobs/backend-engineer", "/jobs/platform-engineer"
)


def _good_layout(layout_fingerprint: str = "x") -> LearnedJobListingLayout:
    return LearnedJobListingLayout(
        domain="careers.example.com",
        sample_url="https://careers.example.com/jobs",
        layout_fingerprint=layout_fingerprint,
        confidence=0.92,
        rules=[
            JobListingRule(selector="header.topbar, footer", role=JobListingAction.IGNORE),
            JobListingRule(
                selector="article.job-card",
                role=JobListingAction.JOB_CARD,
                extract=JobListingExtraction(
                    title="a.job-title",
                    company="span.company",
                    location="span.location",
                    remote_signal="span.location",
                    employment_type="span.type",
                    detail_url="a.job-title@href",
                    description="p.summary",
                ),
            ),
            JobListingRule(selector="a.next", role=JobListingAction.NEXT_PAGE),
            JobListingRule(selector="select[name=remote]", role=JobListingAction.FILTER_CONTROL),
            JobListingRule(selector="input[name=q]", role=JobListingAction.SEARCH_INPUT),
        ],
    )


class _FakeLLM:
    def __init__(self) -> None:
        self.calls = 0
        self.prompts: list[str] = []
        self.system_prompts: list[str | None] = []

    def structured(self, prompt, schema, system=None, max_tokens=2048):
        self.calls += 1
        self.prompts.append(prompt)
        self.system_prompts.append(system)
        return _good_layout()


def test_listing_dom_inventory_is_separate_and_exposes_job_controls():
    inventory = build_listing_dom_inventory(_LISTINGS, "https://careers.example.com/jobs")

    assert "selector='article.job-card'" in inventory
    assert "'Backend Engineer'->https://careers.example.com/jobs/backend-engineer" in inventory
    assert "placeholder='Search jobs'" in inventory
    assert "options=['Any', 'Remote', 'On-site']" in inventory


def test_listing_inventory_tags_clickable_div_as_interaction_candidate():
    html = '<div class="job-card" role="button" tabindex="0" aria-controls="panel">Open job</div>'
    inventory = build_listing_dom_inventory(html, "https://careers.example.com/jobs")
    assert "interaction='click_candidate'" in inventory
    assert "aria-controls='panel'" in inventory


def test_listing_rules_extract_jobs_and_next_page_deterministically():
    layout = _good_layout()
    listings, next_urls, filters, searches = apply_listing_rules(
        _LISTINGS,
        "https://careers.example.com/jobs",
        "https://careers.example.com",
        layout.rules,
    )

    assert [listing.title for listing in listings] == ["Backend Engineer", "ML Engineer"]
    assert listings[0].detail_url == "https://careers.example.com/jobs/backend-engineer"
    assert listings[0].remote_signal == "Remote - Philippines"
    assert next_urls == ["https://careers.example.com/jobs?page=2"]
    assert filters == ["Any Remote On-site"]
    assert searches == ["input[name=q]"]


def test_planner_caches_same_layout_rules_without_second_ai_call():
    llm = _FakeLLM()
    store = JobListingLayoutStore(output_dir=None)
    planner = JobListingPlanner(llm, store=store)

    first = planner.plan_page("https://careers.example.com/jobs", _LISTINGS)
    second = planner.plan_page("https://careers.example.com/jobs?page=2", _LISTINGS_PAGE_2)

    assert llm.calls == 1
    assert first.extraction_method == "ai_rules"
    assert second.extraction_method == "ai_rules_cache"
    assert second.listings[0].title == "Platform Engineer"


def test_job_listing_fingerprint_reuses_same_template_not_text():
    assert fingerprint(_LISTINGS) == fingerprint(_LISTINGS_PAGE_2)
    different = _LISTINGS.replace('article class="job-card"', 'article class="opening-card"')
    assert fingerprint(_LISTINGS) != fingerprint(different)


def test_store_persists_machine_readable_layout(tmp_path):
    layout = _good_layout(layout_fingerprint="abc")
    store = JobListingLayoutStore(output_dir=tmp_path)

    store.put(layout)

    payload = json.loads(next(tmp_path.glob("careers.example.com-abc.json")).read_text())
    assert payload["rules"][1]["role"] == "job_card"
    assert payload["rules"][1]["extract"]["detail_url"] == "a.job-title@href"
    assert JobListingLayoutStore(output_dir=tmp_path).get("abc").rules[1].role == (
        JobListingAction.JOB_CARD
    )


def test_store_isolates_same_fingerprint_across_domains():
    first = _good_layout(layout_fingerprint="same")
    second = first.model_copy(
        update={
            "domain": "other.example.com",
            "sample_url": "https://other.example.com/jobs",
        }
    )
    store = JobListingLayoutStore(output_dir=None)
    store.put(first)
    store.put(second)

    assert store.get("same") is None
    assert store.get("same", domain="careers.example.com").domain == "careers.example.com"
    assert store.get("same", domain="other.example.com").domain == "other.example.com"


def test_planner_persists_model_rules_with_extracted_output(tmp_path):
    llm = _FakeLLM()
    artifact_store = JobScrapeArtifactStore(tmp_path)
    planner = JobListingPlanner(
        llm,
        store=JobListingLayoutStore(output_dir=None),
        artifact_store=artifact_store,
    )

    planner.plan_page("https://careers.example.com/jobs", _LISTINGS)

    artifact = artifact_store.latest()
    assert artifact is not None
    assert artifact.model_output.rules[1].role == JobListingAction.JOB_CARD
    assert artifact.scraping_output.listings[0].title == "Backend Engineer"
    assert "job-card" in (artifact.rendered_dom or "")


def test_rule_overlay_marks_the_same_selectors_used_by_executor():
    overlay = render_rule_overlay(_LISTINGS, _good_layout())

    assert overlay.count('data-codex-label="EXTRACT + CRAWL"') == 2
    assert 'data-codex-label="CRAWL NEXT"' in overlay
    assert 'data-codex-label="FILL"' in overlay
    assert 'data-codex-label="IGNORE"' in overlay
    assert "AI DOM decisions" in overlay


def test_debug_dom_redacts_visible_email_text_and_attributes():
    sanitized = sanitize_debug_dom(
        '<a aria-label="Sign out: person@example.com">person@example.com</a>'
    )

    assert "person@example.com" not in sanitized
    assert sanitized.count("[redacted-email]") == 2


def test_system_prompt_prioritizes_session_search_and_job_definition():
    llm = _FakeLLM()
    planner = JobListingPlanner(llm, store=JobListingLayoutStore(output_dir=None))

    planner.plan_page(
        "https://careers.example.com/jobs",
        _LISTINGS,
        user_preferences="search remote python backend jobs first",
    )

    system = llm.system_prompts[0] or ""
    assert "Check whether the user is signed in or signed out" in system
    assert "search terms or" in system
    assert "job definition/details" in system
    assert "job title is useful" in system
    assert "dynamic SPA interaction" in system
    assert "workflow.result_item_click_selector" in system
    assert "detail_panel_selector" in system
    assert "Apply/Login/Upload/Submit" in system
    assert "Additional Verification Required" in system
    assert "Just a moment" in system
    assert "do not suggest bypassing" in system
    assert "human handoff" in system
    assert "remote, hybrid, onsite, or any" in system


def test_workflow_can_describe_spa_click_to_reveal_detail_panel():
    layout = LearnedJobListingLayout(
        domain="ph.indeed.com",
        sample_url="https://ph.indeed.com/jobs?q=software",
        layout_fingerprint="spa",
        workflow=JobSearchWorkflow(
            detail_navigation_mode="same_page_panel",
            requires_click_to_reveal_detail=True,
            result_item_click_selector="a[href*='/viewjob']",
            detail_panel_selector=".jobsearch-RightPane",
            detail_loaded_selector="#jobDescriptionText",
            navigation_notes=["Click a job title to update the right-side detail panel."],
        ),
        rules=[
            JobListingRule(
                selector=".job_seen_beacon",
                role=JobListingAction.JOB_CARD,
                extract=JobListingExtraction(
                    company=".companyName",
                    location=".companyLocation",
                    detail_url="a@href",
                    description=".job-snippet",
                ),
            ),
            JobListingRule(selector="a[href*='/viewjob']", role=JobListingAction.OPEN_DETAIL),
            JobListingRule(selector=".jobsearch-RightPane", role=JobListingAction.DETAIL_PANEL),
        ],
    )

    payload = layout.model_dump(mode="json")

    assert payload["workflow"]["detail_navigation_mode"] == "same_page_panel"
    assert payload["workflow"]["requires_click_to_reveal_detail"] is True
    assert payload["workflow"]["result_item_click_selector"] == "a[href*='/viewjob']"
    assert payload["workflow"]["detail_panel_selector"] == ".jobsearch-RightPane"
    assert payload["rules"][1]["role"] == "open_detail"
    assert payload["rules"][2]["role"] == "detail_panel"


def test_detail_page_rules_can_extract_definition_without_job_card_title():
    html = """
    <html><body>
      <main class="job-detail">
        <section class="description">You will build APIs and automation workflows.</section>
        <section class="requirements">Python, SQL, testing, and production debugging.</section>
        <section class="benefits">Remote work and learning budget.</section>
        <a class="apply" href="/apply/123">Apply now</a>
      </main>
    </body></html>
    """
    layout = LearnedJobListingLayout(
        domain="careers.example.com",
        sample_url="https://careers.example.com/job/123",
        layout_fingerprint="detail",
        page_type="job_detail",
        workflow=JobSearchWorkflow(
            check_signed_in_first=True,
            signed_out_selector="sign in",
            recommended_search_terms=["python backend remote"],
        ),
        rules=[
            JobListingRule(
                selector="main.job-detail",
                role=JobListingAction.JOB_DESCRIPTION,
                extract=JobListingExtraction(
                    description="section.description",
                    requirements="section.requirements",
                    benefits="section.benefits",
                ),
            ),
            JobListingRule(selector="a.apply", role=JobListingAction.APPLY_LINK),
        ],
    )

    listings, _next_urls, _filters, _searches = apply_listing_rules(
        html,
        "https://careers.example.com/job/123",
        "https://careers.example.com",
        layout.rules,
    )

    assert len(listings) == 1
    assert listings[0].title is None
    assert listings[0].description == "You will build APIs and automation workflows."
    assert listings[0].requirements == "Python, SQL, testing, and production debugging."
    assert listings[0].benefits == "Remote work and learning budget."
    assert listings[0].apply_url == "https://careers.example.com/apply/123"
