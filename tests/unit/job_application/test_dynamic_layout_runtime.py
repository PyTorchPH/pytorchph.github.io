from __future__ import annotations

import json

from resume_builder.job_application.dynamic_layout_runtime import (
    DynamicApplicationRuleStore,
    capture_unknown_application_layout,
)
from resume_builder.job_application.models import DynamicApplicationPlan, WebsitePageSample


def test_dynamic_rule_cache_is_scoped_to_subdomain_and_fingerprint(tmp_path):
    store = DynamicApplicationRuleStore(tmp_path)
    plan = DynamicApplicationPlan(
        root_domain="example.com",
        samples=[
            WebsitePageSample(
                url="https://apply.example.com/form",
                subdomain="apply.example.com",
                layout_fingerprint="abc123",
            )
        ],
        confidence=0.9,
    )

    path = store.put("apply.example.com", "abc123", plan)

    assert path == tmp_path / "apply.example.com" / "abc123.json"
    assert store.get("apply.example.com", "abc123") == plan
    assert store.get("jobs.example.com", "abc123") is None
    assert store.get("apply.example.com", "different") is None


def test_unknown_layout_capture_strips_query_and_defers_without_model(tmp_path, monkeypatch):
    class Page:
        url = "https://apply.example.com/form?token=secret"

        @staticmethod
        def content():
            return '<html><body><label>Email</label><input name="email" value="private"></body></html>'

    monkeypatch.setattr(
        "resume_builder.job_application.dynamic_layout_runtime.dynamic_planner_status",
        lambda: {"provider": "openai-compatible", "ready": False},
    )

    output = tmp_path / "capture"
    result = capture_unknown_application_layout(
        Page(),
        output_dir=output,
        cache_dir=tmp_path / "cache",
    )

    assert result["status"] == "model_not_configured"
    assert result["url"] == "https://apply.example.com/form"
    assert "secret" not in (output / "capture.json").read_text(encoding="utf-8")
    assert json.loads((output / "capture.json").read_text(encoding="utf-8"))[
        "layout_fingerprint"
    ]
