from __future__ import annotations
import pytest
from resume_builder.job_application.state_machine import WorkflowStateMachine

sm = WorkflowStateMachine()

def test_review_to_submit_raises_without_human_approved():
    with pytest.raises(ValueError):
        sm.transition("Review", "Submit")

def test_review_to_submit_ok_with_human_approved():
    assert sm.transition("Review", "Submit", human_approved=True) == "Submit"

def test_illegal_transition_raises():
    with pytest.raises(ValueError):
        sm.transition("Search", "Submit")

def test_human_handoff_reachable_from_search():
    assert sm.transition("Search", "HumanHandoff") == "HumanHandoff"

def test_eligibility_to_ineligible():
    assert sm.transition("Eligibility", "Ineligible") == "Ineligible"

def test_next_states_eligibility():
    ns = sm.next_states("Eligibility")
    assert "Ineligible" in ns
    assert "Login" in ns
    assert "ResumeUpload" in ns

def test_can_transition_search_open():
    assert sm.can_transition("Search", "Open") is True

def test_can_transition_search_submit():
    assert sm.can_transition("Search", "Submit") is False
