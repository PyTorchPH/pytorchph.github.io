from __future__ import annotations
import pytest
from resume_builder.job_application.models import (
    ApplicationPlan, PlatformInfo, WorkflowInfo, DetectedField,
    MissingInformation, Hitl,
)

def test_valid_application_plan_builds():
    plan = ApplicationPlan(
        platform=PlatformInfo(vendor="LinkedIn"),
        workflow=WorkflowInfo(states=["Search", "Open"], current_state="Open"),
    )
    assert plan.hitl.stop_before == "Submit"

def test_hitl_gate_enforced_on_wrong_stop_before():
    with pytest.raises(ValueError):
        ApplicationPlan(
            platform=PlatformInfo(vendor="LinkedIn"),
            workflow=WorkflowInfo(),
            hitl=Hitl(stop_before="Foo"),
        )

def test_application_plan_defaults_are_independent():
    plan1 = ApplicationPlan(platform=PlatformInfo(vendor="A"), workflow=WorkflowInfo())
    plan2 = ApplicationPlan(platform=PlatformInfo(vendor="B"), workflow=WorkflowInfo())
    plan1.detected_fields.append(DetectedField(selector_hint="#f", canonical="email", kind="email"))
    assert len(plan2.detected_fields) == 0

def test_detected_field_defaults():
    f = DetectedField(selector_hint="#x", canonical="email", kind="email")
    assert f.required is False
    assert f.mapped_value is None
    assert f.confidence == 0.0

def test_missing_information_serializes():
    m = MissingInformation(canonical="salary", label="Expected Salary", reason="judgment field")
    d = m.model_dump()
    assert d["canonical"] == "salary"
    assert d["reason"] == "judgment field"
