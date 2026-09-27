from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright

from resume_builder.job_application.executor import ExecutionStatus, SafeApplicationExecutor
from resume_builder.job_application.models import (
    ApplicationPlan,
    BrowserAction,
    DynamicApplicationPlan,
    DynamicInteractionStep,
    PlatformInfo,
    WorkflowInfo,
)
from resume_builder.job_application.ledger import ApplicationLedger, LedgerState
from resume_builder.job_application.permissions import ApplicationPermissionPolicy
from resume_builder.job_application.submission_history import ApplicationSubmissionHistory


FORM_HTML = """
<!doctype html>
<html>
  <body>
    <nav>My applications <button type="button">Sign out</button></nav>
    <form id="application">
      <label>Name <input id="name" name="name"></label>
      <label>Email <input id="email" name="email" type="email"></label>
      <label>Resume <input id="resume" name="resume" type="file"></label>
      <button id="submit-application" type="submit">Send application</button>
    </form>
    <p id="confirmation" hidden></p>
    <script>
      document.querySelector('#application').addEventListener('submit', event => {
        event.preventDefault();
        const confirmation = document.querySelector('#confirmation');
        confirmation.textContent = 'Application received: TEST-001';
        confirmation.hidden = false;
      });
    </script>
  </body>
</html>
"""


def _plans(resume: Path) -> tuple[ApplicationPlan, DynamicApplicationPlan]:
    application_plan = ApplicationPlan(
        platform=PlatformInfo(vendor="Local Mock ATS", confidence=1.0),
        workflow=WorkflowInfo(states=["Draft", "Review", "Submit"], current_state="Draft"),
        browser_actions=[
            BrowserAction(step=1, action="fill", target="#name", value="Test Candidate"),
            BrowserAction(step=2, action="fill", target="#email", value="test@example.com"),
            BrowserAction(step=3, action="upload", target="#resume", value=str(resume)),
        ],
    )
    dynamic_plan = DynamicApplicationPlan(
        root_domain="local.test",
        confidence=1.0,
        interaction_steps=[
            DynamicInteractionStep(
                step=4,
                action="final_submit",
                selector="#submit-application",
                purpose="Send the reviewed application",
                expected_change="A confirmation reference becomes visible",
                wait_for_selector="#confirmation",
                requires_human=True,
            )
        ],
    )
    return application_plan, dynamic_plan


def test_browser_executor_fills_resume_but_stops_before_unapproved_submit(tmp_path: Path) -> None:
    resume = tmp_path / "resume.pdf"
    resume.write_bytes(b"%PDF-1.4\n% local integration fixture\n")
    application_plan, dynamic_plan = _plans(resume)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(FORM_HTML)

        result = SafeApplicationExecutor().execute(page, application_plan, dynamic_plan)

        assert result.status == ExecutionStatus.DRAFT_READY
        assert result.stopped_before_submit is True
        assert page.locator("#name").input_value() == "Test Candidate"
        assert page.locator("#email").input_value() == "test@example.com"
        assert page.locator("#resume").evaluate("element => element.files[0].name") == "resume.pdf"
        assert page.locator("#confirmation").is_hidden()
        assert result.events[-1].action == "final_submit"
        assert result.events[-1].status == "blocked"
        browser.close()


def test_browser_executor_submits_once_after_explicit_human_approval(tmp_path: Path) -> None:
    resume = tmp_path / "resume.pdf"
    resume.write_bytes(b"%PDF-1.4\n% local integration fixture\n")
    application_plan, dynamic_plan = _plans(resume)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(FORM_HTML)

        result = SafeApplicationExecutor().execute(
            page,
            application_plan,
            dynamic_plan,
            human_approved=True,
            submission_history=None,
        )

        assert result.status == ExecutionStatus.SUBMITTED
        assert result.stopped_before_submit is False
        assert result.confirmation_text == "Application received: TEST-001"
        assert page.locator("#confirmation").is_visible()
        assert sum(event.action == "final_submit" for event in result.events) == 1
        browser.close()


def test_browser_executor_autonomous_submit_is_explicit_and_idempotent(tmp_path: Path) -> None:
    resume = tmp_path / "resume.pdf"
    resume.write_bytes(b"%PDF-1.4\n")
    application_plan, dynamic_plan = _plans(resume)
    ledger = ApplicationLedger(tmp_path / "ledger.json")
    policy = ApplicationPermissionPolicy(autonomous_submit=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(FORM_HTML)
        first = SafeApplicationExecutor().execute(
            page,
            application_plan,
            dynamic_plan,
            permission_policy=policy,
            application_id="company:job-1",
            ledger=ledger,
            submission_history=None,
        )
        second = SafeApplicationExecutor().execute(
            page,
            application_plan,
            dynamic_plan,
            permission_policy=policy,
            application_id="company:job-1",
            ledger=ledger,
            submission_history=None,
        )
        assert first.status == ExecutionStatus.SUBMITTED
        assert second.status == ExecutionStatus.ALREADY_SUBMITTED
        assert ledger.get("company:job-1").state == LedgerState.SUBMITTED
        browser.close()


def test_browser_executor_skips_recent_exact_company_title_from_sql_history(
    tmp_path: Path,
) -> None:
    resume = tmp_path / "resume.pdf"
    resume.write_bytes(b"%PDF-1.4\n")
    application_plan, dynamic_plan = _plans(resume)
    history = ApplicationSubmissionHistory(tmp_path / "applications.sqlite3")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(FORM_HTML)
        first = SafeApplicationExecutor().execute(
            page,
            application_plan,
            dynamic_plan,
            human_approved=True,
            submission_history=history,
            company="Example Company",
            job_title="Backend Engineer",
        )
        page.set_content(FORM_HTML)
        second = SafeApplicationExecutor().execute(
            page,
            application_plan,
            dynamic_plan,
            human_approved=True,
            submission_history=history,
            company=" example company ",
            job_title="Backend   Engineer",
        )

        assert first.status == ExecutionStatus.SUBMITTED
        assert second.status == ExecutionStatus.ALREADY_SUBMITTED
        assert second.events[-1].action == "submission_history_check"
        assert page.locator("#confirmation").is_hidden()
        browser.close()


def test_submit_without_confirmation_proof_is_unknown(tmp_path: Path) -> None:
    resume = tmp_path / "resume.pdf"
    resume.write_bytes(b"%PDF-1.4\n")
    application_plan, dynamic_plan = _plans(resume)
    dynamic_plan.interaction_steps[0].wait_for_selector = None

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(FORM_HTML)
        result = SafeApplicationExecutor().execute(
            page,
            application_plan,
            dynamic_plan,
            human_approved=True,
            submission_history=None,
        )
        assert result.status == ExecutionStatus.SUBMISSION_UNKNOWN
        assert result.events[-1].status == "unknown"
        browser.close()


def test_executor_rejects_plan_for_another_domain() -> None:
    application_plan = ApplicationPlan(
        platform=PlatformInfo(vendor="Mock"), workflow=WorkflowInfo()
    )
    dynamic_plan = DynamicApplicationPlan(root_domain="trusted.example.com")

    class Page:
        url = "https://evil.example.net/application"

    result = SafeApplicationExecutor().execute(Page(), application_plan, dynamic_plan)
    assert result.status == ExecutionStatus.HUMAN_HANDOFF
    assert result.events[0].action == "validate_plan"
