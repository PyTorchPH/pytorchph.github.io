from __future__ import annotations

import json
from argparse import Namespace

import pytest

from resume_builder.job_finder import (
    JobListingAction,
    JobListingExtraction,
    JobListingRule,
    LearnedJobListingLayout,
    fingerprint,
)
from tools.job_finder.cdp_tag import (
    _apply,
    _country_selection_policy,
    _load_capture,
    _parser,
    _validate_layout,
)


HTML = """
<main>
  <article class="job-card">
    <a class="job-title" href="/viewjob?id=1">Python Engineer</a>
    <span class="company">Example Co</span>
  </article>
  <a class="next" href="/jobs?start=10">Next</a>
</main>
"""


def layout() -> LearnedJobListingLayout:
    return LearnedJobListingLayout(
        domain="jobs.example.com",
        sample_url="https://jobs.example.com/jobs",
        layout_fingerprint=fingerprint(HTML),
        confidence=0.95,
        rules=[
            JobListingRule(
                selector="article.job-card",
                role=JobListingAction.JOB_CARD,
                extract=JobListingExtraction(
                    title="a.job-title",
                    company="span.company",
                    detail_url="a.job-title@href",
                ),
            ),
            JobListingRule(selector="a.next", role=JobListingAction.NEXT_PAGE),
        ],
    )


def test_validate_layout_rejects_cross_domain_rules():
    candidate = layout().model_copy(update={"domain": "other.example.com"})

    with pytest.raises(SystemExit, match="domain does not match"):
        _validate_layout(candidate, HTML, {"url": "https://jobs.example.com/jobs"})


def test_load_capture_refuses_a_blocked_access_decision(tmp_path):
    (tmp_path / "source.html").write_text(HTML, encoding="utf-8")
    (tmp_path / "capture.json").write_text(
        json.dumps(
            {
                "url": "https://jobs.example.com/jobs",
                "should_continue": False,
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(SystemExit, match="human handoff"):
        _load_capture(tmp_path)


def test_work_mode_flag_is_explicit_and_bounded():
    args = _parser().parse_args(["api-plan", "--work-mode", "hybrid"])

    assert args.work_mode == "hybrid"


def test_foreign_country_flags_require_remote_and_exclude_home_country():
    args = _parser().parse_args(
        [
            "api-plan",
            "--foreign-only",
            "--home-country",
            "Philippines",
            "--home-country-alias",
            "PH",
            "--target-country",
            "Australia",
            "--target-country",
            "Canada",
            "--work-mode",
            "remote",
        ]
    )

    policy = _country_selection_policy(args)

    assert policy is not None
    assert policy.selected_countries == ("Australia", "Canada")


def test_foreign_country_flags_reject_home_country():
    args = _parser().parse_args(
        [
            "api-plan",
            "--foreign-only",
            "--home-country",
            "Philippines",
            "--target-country",
            "Philippines",
            "--work-mode",
            "remote",
        ]
    )

    with pytest.raises(SystemExit, match="home country"):
        _country_selection_policy(args)


def test_country_selection_can_include_philippines_when_human_selects_it():
    args = _parser().parse_args(
        [
            "api-plan",
            "--target-country",
            "Philippines",
            "--target-country",
            "Australia",
            "--work-mode",
            "remote",
        ]
    )

    policy = _country_selection_policy(args)

    assert policy is not None
    assert policy.selected_countries == ("Philippines", "Australia")
    assert not policy.exclude_home_country


def test_apply_uses_captured_html_and_strict_rules(tmp_path, monkeypatch):
    (tmp_path / "source.html").write_text(HTML, encoding="utf-8")
    (tmp_path / "capture.json").write_text(
        json.dumps({"url": "https://jobs.example.com/jobs"}), encoding="utf-8"
    )
    rules = tmp_path / "rules.json"
    rules.write_text(layout().model_dump_json(), encoding="utf-8")
    captured = {}

    def fake_render(output_dir, html, selected_layout, run, **kwargs):
        captured["run"] = run
        captured["layout"] = selected_layout

    monkeypatch.setattr("tools.job_finder.cdp_tag._render_outputs", fake_render)
    result = _apply(
        Namespace(
            output_dir=tmp_path,
            rules=rules,
            cdp_url="http://127.0.0.1:9222",
        )
    )

    assert result == 0
    assert captured["run"].listings[0].title == "Python Engineer"
    assert captured["run"].extraction_method == "current_session_development_rules"
    assert captured["layout"].layout_fingerprint == fingerprint(HTML)
