from __future__ import annotations

import pytest

from resume_builder.job_application import (
    ApplicationWebsitePlanner,
    DynamicApplicationPlan,
    DynamicInteractionStep,
    build_application_dom_inventory,
    sample_subdomain_layouts,
)


_LISTING = """
<main><div class="job-card" role="button" tabindex="0" aria-controls="details">Engineer</div>
<section id="details"></section></main>
"""
_FORM = """
<main><button class="accordion" aria-expanded="false" aria-controls="work">Work history</button>
<div id="work"><input name="company"><button type="button">Add another</button></div>
<button type="submit">Submit application</button></main>
"""


class _LLM:
    def __init__(self) -> None:
        self.prompt = ""
        self.system = ""

    def structured(self, prompt, schema, system=None, max_tokens=2048):
        self.prompt = prompt
        self.system = system or ""
        return schema(
            root_domain="example.com",
            interaction_steps=[
                {
                    "step": 1,
                    "action": "click",
                    "selector": "button.accordion",
                    "purpose": "reveal work history fields",
                    "wait_for_selector": "div#work",
                    "expected_change": "work history section becomes visible",
                    "safe_read_only": True,
                },
                {
                    "step": 2,
                    "action": "final_submit",
                    "selector": "button[type=submit]",
                    "purpose": "submit reviewed application",
                    "requires_human": True,
                },
            ],
        )


def test_inventory_tags_clickable_non_link_controls():
    inventory = build_application_dom_inventory(_FORM, "https://apply.example.com/form")
    assert "selector='button.accordion'" in inventory
    assert "interaction='click_candidate'" in inventory
    assert "selector=\"input[name='company']\"" in inventory
    assert "interaction='field_candidate'" in inventory


def test_sampling_covers_sibling_subdomains_and_unique_layouts():
    samples = sample_subdomain_layouts(
        [
            ("https://jobs.example.com/search", _LISTING),
            ("https://jobs.example.com/search?page=2", _LISTING),
            ("https://apply.example.com/form", _FORM),
            ("https://evil.example.net/form", _FORM),
        ]
    )
    assert [sample.subdomain for sample in samples] == ["jobs.example.com", "apply.example.com"]


def test_planner_emits_ordered_dynamic_steps_from_samples():
    llm = _LLM()
    plan = ApplicationWebsitePlanner(llm).plan(
        [("https://jobs.example.com/search", _LISTING), ("https://apply.example.com/form", _FORM)]
    )
    assert len(plan.samples) == 2
    assert plan.interaction_steps[0].wait_for_selector == "div#work"
    assert plan.interaction_steps[1].requires_human is True
    assert "non-link controls" in llm.system
    assert "questionnaire_container" in llm.system
    assert "saved-resume choices" in llm.system
    assert "remote/hybrid/onsite/any" in llm.system
    assert "apply.example.com" in llm.prompt


def test_final_submit_requires_human():
    with pytest.raises(ValueError, match="requires_human"):
        DynamicInteractionStep(
            step=1,
            action="final_submit",
            selector="button.submit",
            purpose="submit",
        )


def test_dynamic_plan_serializes_strict_contract():
    payload = DynamicApplicationPlan(root_domain="example.com").model_dump(mode="json")
    assert payload["samples"] == [] and payload["interaction_steps"] == []
    assert payload["dom_rules"] == []
