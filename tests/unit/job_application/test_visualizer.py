from resume_builder.job_application import (
    ApplicationDomRule,
    DynamicApplicationPlan,
    render_application_overlay,
)
import pytest


def test_application_overlay_tags_container_nested_fields_and_human_gate():
    html = """
    <main id="questions">
      <div class="question"><input name="work_authorization"></div>
      <button class="submit">Submit application</button>
    </main>
    """
    plan = DynamicApplicationPlan(
        root_domain="example.com",
        dom_rules=[
            ApplicationDomRule(
                selector="main#questions",
                role="questionnaire_container",
                include_descendants=True,
            ),
            ApplicationDomRule(selector="input[name=work_authorization]", role="question_field"),
            ApplicationDomRule(
                selector="button.submit",
                role="final_submit",
                requires_human=True,
            ),
        ],
    )

    overlay = render_application_overlay(html, plan)

    assert 'data-app-label="QUESTIONNAIRE"' in overlay
    assert 'data-app-label="QUESTION FIELD"' in overlay
    assert 'data-app-label="FINAL SUBMIT · HUMAN"' in overlay


def test_resume_and_transition_dom_rules_require_human_gate():
    for role in ("resume_choice", "resume_upload", "continue_review", "final_submit"):
        with pytest.raises(ValueError, match="requires_human"):
            ApplicationDomRule(selector="button.control", role=role)
