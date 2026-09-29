from __future__ import annotations

import pytest

from resume_builder.job_finder import (
    INDEED_ADAPTER,
    JOBSTREET_ADAPTER,
    JobListingAction,
    JobListingExtraction,
    JobListingLayoutStore,
    JobListingPlanner,
    JobListingRule,
    LearnedJobListingLayout,
    SiteAdapterDriftError,
    WorkMode,
    resolve_site_adapter,
)


INDEED_SEARCH = """
<form>
  <input id="text-input-what" name="q" placeholder="Job title, keywords, or company">
  <input id="text-input-where" name="l"
         placeholder='City, state, zip code, or "remote"'>
  <button class="yosegi-InlineWhatWhere-primaryButton">Find jobs</button>
</form>
"""

JOBSTREET_SEARCH = """
<section>
  <input name="keywords" placeholder="Keywords">
  <input name="where" placeholder="Location">
  <select name="workType">
    <option>Any</option>
    <option>Remote</option>
    <option>Hybrid</option>
    <option>On-site</option>
  </select>
  <button class="search-submit">Search</button>
</section>
"""


def test_indeed_remote_plan_uses_advertised_location_value():
    plan = INDEED_ADAPTER.build_search_plan(
        "https://ph.indeed.com/",
        INDEED_SEARCH,
        keyword="Python",
        work_mode=WorkMode.REMOTE,
    )

    assert [(step.action, step.value) for step in plan.steps] == [
        ("fill", "Python"),
        ("fill", "remote"),
        ("click", None),
    ]
    assert plan.location == "remote"
    assert plan.capability_evidence == ['location placeholder: City, state, zip code, or "remote"']


def test_indeed_remote_plan_stops_when_placeholder_no_longer_advertises_remote():
    changed = INDEED_SEARCH.replace('City, state, zip code, or "remote"', "City or postal code")

    with pytest.raises(SiteAdapterDriftError, match="does not advertise remote"):
        INDEED_ADAPTER.build_search_plan(
            "https://ph.indeed.com/",
            changed,
            keyword="Python",
            work_mode="remote",
        )


def test_work_mode_is_never_silently_substituted():
    with pytest.raises(SiteAdapterDriftError, match="no verified deterministic hybrid"):
        INDEED_ADAPTER.build_search_plan(
            "https://ph.indeed.com/",
            INDEED_SEARCH,
            keyword="Python",
            work_mode="hybrid",
        )


@pytest.mark.parametrize("mode", [WorkMode.REMOTE, WorkMode.HYBRID])
def test_jobstreet_uses_explicit_work_mode_filter(mode):
    plan = JOBSTREET_ADAPTER.build_search_plan(
        "https://www.jobstreet.com.ph/",
        JOBSTREET_SEARCH,
        keyword="Python",
        work_mode=mode,
    )

    assert plan.steps[1].action == "select_option"
    assert plan.steps[1].value == mode.value.title()
    assert plan.steps[-1].action == "click"


def test_registry_matches_supported_subdomains_only():
    assert resolve_site_adapter("https://ph.indeed.com/jobs").site_id == "indeed"
    assert resolve_site_adapter("https://www.jobstreet.com.ph/python-jobs").site_id == "jobstreet"
    assert resolve_site_adapter("https://evilindeed.com/jobs") is None
    assert resolve_site_adapter("https://careers.example.com/jobs") is None


def test_known_domain_layout_drift_falls_back_to_ai_sampling():
    drifted = """
    <main>
      <article class="opening">
        <a class="title" href="/job/python">Python Developer</a>
      </article>
    </main>
    """

    class DriftFallbackLLM:
        calls = 0

        def structured(self, prompt, schema, system=None, max_tokens=2048):
            self.calls += 1
            return LearnedJobListingLayout(
                domain="ph.indeed.com",
                sample_url="https://ph.indeed.com/jobs",
                layout_fingerprint="replaced-by-planner",
                confidence=0.8,
                rules=[
                    JobListingRule(
                        selector="article.opening",
                        role=JobListingAction.JOB_CARD,
                        extract=JobListingExtraction(
                            title="a.title",
                            detail_url="a.title@href",
                        ),
                    )
                ],
            )

    llm = DriftFallbackLLM()
    run = JobListingPlanner(
        llm,
        store=JobListingLayoutStore(output_dir=None),
    ).plan_page("https://ph.indeed.com/jobs", drifted)

    assert llm.calls == 1
    assert run.extraction_method == "ai_rules"
    assert run.listings[0].title == "Python Developer"
