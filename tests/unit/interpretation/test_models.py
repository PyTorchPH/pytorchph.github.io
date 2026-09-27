from __future__ import annotations

from resume_builder.interpretation.models import (
    RetrievedSource,
    TagRunReport,
    UserProfile,
)


def test_retrieved_source_defaults():
    s = RetrievedSource(source_id="owner/repo", kind="project")
    assert s.text == "" and s.origin == ""


def test_tag_run_report_success_rate():
    r = TagRunReport(sent=4, returned=3, failed=1)
    assert abs(r.success_rate - 0.75) < 1e-9
    assert TagRunReport().success_rate == 0.0  # no sends → 0, no ZeroDivision


def test_user_profile_defaults_independent():
    a, b = UserProfile(), UserProfile()
    a.skills.append("Python")
    assert b.skills == []
