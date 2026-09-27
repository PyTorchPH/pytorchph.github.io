from __future__ import annotations

from resume_builder.job_finder import (
    JobListingAction,
    JobListingExtraction,
    JobListingLayoutStore,
    JobListingPlanner,
    JobListingRule,
    LearnedJobListingLayout,
)

_INDEED_PH = """
<html><body>
  <header class="gnav"><a href="/account/login">Sign in</a></header>
  <form class="jobsearch-SearchBox">
    <input name="q" type="text" placeholder="Job title, keywords, or company">
    <input name="l" type="text" placeholder="City, province, or remote">
    <button class="yosegi-InlineWhatWhere-primaryButton" type="submit">Find jobs</button>
  </form>
  <main class="jobsearch-ResultsList">
    <div class="job_seen_beacon">
      <h2 class="jobTitle"><a href="/viewjob?jk=backend123">Backend Engineer</a></h2>
      <span class="companyName">Northstar Labs</span>
      <div class="companyLocation">Remote in Philippines</div>
      <div class="metadata salary-snippet">PHP 90,000 - PHP 130,000 a month</div>
      <div class="metadata job-type">Full-time</div>
      <div class="job-snippet">Build APIs, data pipelines, and internal developer tools.</div>
    </div>
    <div class="job_seen_beacon">
      <h2 class="jobTitle"><a href="/viewjob?jk=ml456">Machine Learning Engineer</a></h2>
      <span class="companyName">Northstar Labs</span>
      <div class="companyLocation">Taguig</div>
      <div class="metadata job-type">Hybrid</div>
      <div class="job-snippet">Deploy ranking models and evaluation pipelines.</div>
    </div>
    <nav class="pagination"><a aria-label="Next" href="/jobs?q=engineer&start=10">Next</a></nav>
  </main>
  <footer>Terms, privacy, and repeated site links</footer>
</body></html>
"""

_INDEED_PH_PAGE_2 = _INDEED_PH.replace("Backend Engineer", "Platform Engineer").replace(
    "backend123", "platform789"
)

_JOBSTREET_PH = """
<html><body>
  <header class="site-header"><a href="/candidate/login">Login</a></header>
  <section class="search-panel">
    <input name="keywords" placeholder="Job title, keyword, or company">
    <input name="where" placeholder="Location">
    <select name="workType"><option>Any work type</option><option>Full time</option></select>
    <button class="search-submit">Search</button>
  </section>
  <main class="job-results">
    <article class="job-card">
      <a class="job-title" href="/job/752101-backend-engineer">Backend Engineer</a>
      <span class="company-name">MangoByte PH</span>
      <span class="job-location">Makati City</span>
      <span class="work-arrangement">Hybrid</span>
      <span class="work-type">Full time</span>
      <p class="job-summary">Own Python services, integrations, and production dashboards.</p>
    </article>
    <article class="job-card">
      <a class="job-title" href="/job/752102-data-engineer">Data Engineer</a>
      <span class="company-name">MangoByte PH</span>
      <span class="job-location">Remote</span>
      <span class="work-arrangement">Remote</span>
      <span class="work-type">Contract</span>
      <p class="job-summary">Build ETL jobs and analytics warehouse models.</p>
    </article>
    <a class="next-page" href="/jobs?page=2">Next</a>
  </main>
  <footer>About SEEK, privacy, terms</footer>
</body></html>
"""

_JOBSTREET_PH_PAGE_2 = _JOBSTREET_PH.replace("Backend Engineer", "AI Engineer").replace(
    "752101-backend-engineer", "752103-ai-engineer"
)


def _indeed_layout() -> LearnedJobListingLayout:
    return LearnedJobListingLayout(
        domain="ph.indeed.com",
        sample_url="https://ph.indeed.com/jobs?q=engineer",
        layout_fingerprint="llm-will-be-overwritten",
        confidence=0.91,
        rules=[
            JobListingRule(selector="header.gnav, footer", role=JobListingAction.IGNORE),
            JobListingRule(
                selector="div.job_seen_beacon",
                role=JobListingAction.JOB_CARD,
                extract=JobListingExtraction(
                    title="a",
                    company="span.companyName",
                    location="div.companyLocation",
                    remote_signal="div.companyLocation",
                    salary_signal="div.salary-snippet",
                    employment_type="div.job-type",
                    detail_url="a@href",
                    description="div.job-snippet",
                ),
            ),
            JobListingRule(selector="a[aria-label=Next]", role=JobListingAction.NEXT_PAGE),
            JobListingRule(
                selector="input[name=q], input[name=l]", role=JobListingAction.SEARCH_INPUT
            ),
            JobListingRule(
                selector="button.yosegi-InlineWhatWhere-primaryButton",
                role=JobListingAction.SUBMIT_SEARCH,
            ),
        ],
    )


def _jobstreet_layout() -> LearnedJobListingLayout:
    return LearnedJobListingLayout(
        domain="www.jobstreet.com.ph",
        sample_url="https://www.jobstreet.com.ph/python-jobs",
        layout_fingerprint="llm-will-be-overwritten",
        confidence=0.93,
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


class _MockSiteLLM:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def structured(self, prompt, schema, system=None, max_tokens=2048):
        self.calls.append(prompt)
        if "ph.indeed.com" in prompt:
            return _indeed_layout()
        if "jobstreet.com.ph" in prompt:
            return _jobstreet_layout()
        raise AssertionError(f"unexpected mock domain in prompt: {prompt[:200]}")


def test_mock_indeed_ph_listing_rules_extract_and_cache():
    llm = _MockSiteLLM()
    planner = JobListingPlanner(llm, store=JobListingLayoutStore(output_dir=None))

    first = planner.plan_page(
        "https://ph.indeed.com/jobs?q=engineer",
        _INDEED_PH,
        user_preferences="remote backend, startup or small company preferred",
    )
    second = planner.plan_page("https://ph.indeed.com/jobs?q=engineer&start=10", _INDEED_PH_PAGE_2)

    assert len(llm.calls) == 0
    assert first.extraction_method == "site_adapter"
    assert second.extraction_method == "site_adapter"
    assert [listing.title for listing in first.listings] == [
        "Backend Engineer",
        "Machine Learning Engineer",
    ]
    assert first.listings[0].company == "Northstar Labs"
    assert first.listings[0].remote_signal == "Remote in Philippines"
    assert first.listings[0].salary_signal == "PHP 90,000 - PHP 130,000 a month"
    assert first.listings[0].detail_url == "https://ph.indeed.com/viewjob?jk=backend123"
    assert first.next_page_urls == ["https://ph.indeed.com/jobs?q=engineer&start=10"]
    assert second.listings[0].title == "Platform Engineer"


def test_mock_jobstreet_ph_listing_rules_extract_and_cache():
    llm = _MockSiteLLM()
    planner = JobListingPlanner(llm, store=JobListingLayoutStore(output_dir=None))

    first = planner.plan_page(
        "https://www.jobstreet.com.ph/python-jobs",
        _JOBSTREET_PH,
        user_preferences="remote or hybrid python/data jobs in the Philippines",
    )
    second = planner.plan_page(
        "https://www.jobstreet.com.ph/python-jobs?page=2", _JOBSTREET_PH_PAGE_2
    )

    assert len(llm.calls) == 0
    assert first.extraction_method == "site_adapter"
    assert second.extraction_method == "site_adapter"
    assert [listing.title for listing in first.listings] == ["Backend Engineer", "Data Engineer"]
    assert first.listings[0].company == "MangoByte PH"
    assert first.listings[1].remote_signal == "Remote"
    assert first.listings[1].employment_type == "Contract"
    assert first.listings[0].detail_url == (
        "https://www.jobstreet.com.ph/job/752101-backend-engineer"
    )
    assert first.next_page_urls == ["https://www.jobstreet.com.ph/jobs?page=2"]
    assert first.filter_controls == ["Any work type Full time"]
    assert second.listings[0].title == "AI Engineer"
