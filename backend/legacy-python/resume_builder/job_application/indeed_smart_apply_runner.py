"""Sequential deterministic execution for verified Indeed Smart Apply modules."""

from __future__ import annotations

from enum import Enum
from pathlib import Path
import re
from typing import Any
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from resume_builder.core.models import Resume

from .access_verification import HumanVerificationQueue
from .indeed_smart_apply import (
    IndeedSmartApplyModule,
    SmartApplyApprovals,
    build_indeed_smart_apply_plan,
    classify_indeed_smart_apply_module,
)
from .autonomous_questions import QuestionPlanningResult
from .indeed_questionnaire import (
    observe_indeed_screening_questions,
    question_set_fingerprint,
)
from .permissions import ApplicationPermissionPolicy
from .shared import check_access_gate, evaluate_final_submit_gate
from .submission_history import (
    ApplicationSubmissionHistory,
    SubmissionDecision,
    default_submission_history,
)


class _DefaultSubmissionHistory:
    pass


_DEFAULT_SUBMISSION_HISTORY = _DefaultSubmissionHistory()
_POST_APPLY_CONFIRMATION = "your application has been submitted"
_VALIDATION_SELECTORS = (
    "[aria-invalid=true]",
    "[role=alert]",
    "[data-testid*=error]",
    ".ia-ValidationError",
)


class IndeedSmartApplyRunStatus(str, Enum):
    GATE_REACHED = "gate_reached"
    REVIEW_READY = "review_ready"
    POST_APPLY = "post_apply"
    HUMAN_HANDOFF = "human_handoff"
    FAILED = "failed"
    SKIPPED_DUPLICATE = "skipped_duplicate"


class IndeedSmartApplyRunResult(BaseModel):
    status: IndeedSmartApplyRunStatus
    module: IndeedSmartApplyModule
    modules_seen: list[IndeedSmartApplyModule] = Field(default_factory=list)
    actions_executed: list[str] = Field(default_factory=list)
    stop_reason: str = ""
    selected_resume: str = ""


def _first(page: Any, selector: str) -> Any:
    return page.locator(selector).first


def _input_value(page: Any, selector: str) -> str:
    locator = _first(page, selector)
    return locator.input_value() if locator.count() else ""


def _attribute(page: Any, selector: str, name: str) -> str:
    locator = _first(page, selector)
    return (locator.get_attribute(name) or "") if locator.count() else ""


def _visible_access_blocker(page: Any) -> str:
    return check_access_gate(page).reason


def _observe_fields(page: Any, module: IndeedSmartApplyModule) -> dict[str, str]:
    if module == IndeedSmartApplyModule.CONTACT:
        return {
            "first_name": _input_value(
                page,
                "[data-testid=name-fields-first-name-input], input[name=firstName]",
            ),
            "last_name": _input_value(
                page,
                "[data-testid=name-fields-last-name-input], input[name=lastName]",
            ),
            "phone": _input_value(page, "input[name=phone], input[type=tel]"),
            "phone_country_iso": _attribute(
                page,
                "[role=combobox][aria-haspopup=listbox]",
                "data-value",
            ),
        }
    if module == IndeedSmartApplyModule.LOCATION:
        body = _first(page, "body").inner_text()
        return {"country": "Philippines" if "Philippines" in body else ""}
    return {}


def _selected_resume(page: Any, approved_resume: Path | None) -> str:
    if approved_resume is None:
        return ""
    return approved_resume.name if approved_resume.name in _first(page, "body").inner_text() else ""


def _execute_action(page: Any, action: Any) -> None:
    locator = _first(page, action.target)
    normalized = action.action.lower().strip()
    if normalized == "upload":
        locator.set_input_files(action.value)
    elif normalized in {"fill", "type"}:
        locator.wait_for(state="visible")
        locator.fill(action.value)
    elif normalized == "click":
        locator.wait_for(state="visible")
        locator.click()
    elif normalized == "final_submit":
        locator.wait_for(state="visible")
        locator.click()
    else:
        raise ValueError(f"unsupported Indeed Smart Apply action: {action.action}")


def _execute_question_step(page: Any, step: Any) -> None:
    locator = _first(page, step.selector)
    if step.action in {"fill", "type"}:
        locator.wait_for(state="visible")
        locator.fill(step.value)
    elif step.action == "select":
        locator.wait_for(state="visible")
        if locator.get_attribute("role") == "combobox":
            test_id = locator.get_attribute("data-testid") or ""
            prefix = test_id.removesuffix("-select-list")
            locator.click()
            filter_input = _first(page, f'[data-testid="{prefix}-filter-input"]')
            filter_input.wait_for(state="visible")
            filter_input.fill(step.value)
            options = page.locator(f'[data-testid^="{prefix}-"][role="option"]')
            matches = [
                options.nth(index)
                for index in range(options.count())
                if options.nth(index).is_visible()
                and options.nth(index).inner_text().strip() == step.value
            ]
            if len(matches) != 1:
                raise ValueError(
                    f"expected one visible exact questionnaire option, found {len(matches)}"
                )
            matches[0].click()
        else:
            locator.get_by_text(step.value, exact=True).last.click()
    elif step.action == "check":
        locator.wait_for(state="visible")
        locator.check()
    else:
        raise ValueError(f"unsupported screening-question action: {step.action}")


def _required_question_answers_present(page: Any) -> bool:
    groups = page.locator('fieldset[role="radiogroup"]')
    for index in range(groups.count()):
        if groups.nth(index).locator("input:checked").count() == 0:
            return False
    for selector in ("input[required]:not([type=radio])", "textarea[required]", "select[required]"):
        fields = page.locator(selector)
        for index in range(fields.count()):
            if not fields.nth(index).input_value().strip():
                return False
    return True


def _visible_body_text(page: Any) -> str:
    body = _first(page, "body")
    return body.inner_text() if body.count() else ""


def _page_observation(page: Any) -> tuple[str, IndeedSmartApplyModule, str]:
    """Capture route plus rendered module identity for same-route React transitions."""
    url = str(page.url)
    text = re.sub(r"\s+", " ", _visible_body_text(page)).strip().casefold()
    return url, classify_indeed_smart_apply_module(url), text


def _wait_for_transition(
    page: Any,
    before: tuple[str, IndeedSmartApplyModule, str],
    *,
    timeout_ms: int = 15_000,
) -> tuple[bool, tuple[str, IndeedSmartApplyModule, str]]:
    interval_ms = 250
    attempts = max(1, timeout_ms // interval_ms)
    for _ in range(attempts):
        observed = _page_observation(page)
        if observed != before:
            return True, observed
        page.wait_for_timeout(interval_ms)
    observed = _page_observation(page)
    return observed != before, observed


def _visible_validation_reason(page: Any) -> str:
    for selector in _VALIDATION_SELECTORS:
        locator = page.locator(selector).first
        if locator.count() and locator.is_visible():
            text = re.sub(r"\s+", " ", locator.inner_text()).strip()
            return text or "visible validation error"
    return ""


def _post_apply_is_confirmed(page: Any) -> bool:
    return (
        classify_indeed_smart_apply_module(str(page.url)) == IndeedSmartApplyModule.POST_APPLY
        and _POST_APPLY_CONFIRMATION in _visible_body_text(page).casefold()
    )


def _wait_for_post_apply_confirmation(page: Any, *, timeout_ms: int = 15_000) -> bool:
    interval_ms = 250
    attempts = max(1, timeout_ms // interval_ms)
    for _ in range(attempts):
        if _post_apply_is_confirmed(page):
            return True
        page.wait_for_timeout(interval_ms)
    return _post_apply_is_confirmed(page)


def _wait_for_final_submit_gate(
    page: Any,
    selector: str,
    *,
    timeout_ms: int = 20_000,
) -> Any:
    """Allow the hydrated review control to appear without ever clicking it twice."""
    interval_ms = 250
    attempts = max(1, timeout_ms // interval_ms)
    result = evaluate_final_submit_gate(page, selector)
    for _ in range(attempts):
        if result.allowed or result.access.blocked:
            return result
        page.wait_for_timeout(interval_ms)
        result = evaluate_final_submit_gate(page, selector)
    return result


def _wait_for_known_module(page: Any, *, timeout_ms: int = 15_000) -> IndeedSmartApplyModule:
    interval_ms = 250
    attempts = max(1, timeout_ms // interval_ms)
    for _ in range(attempts):
        module = classify_indeed_smart_apply_module(str(page.url))
        if module != IndeedSmartApplyModule.UNKNOWN:
            return module
        page.wait_for_timeout(interval_ms)
    return classify_indeed_smart_apply_module(str(page.url))


def run_indeed_smart_apply_until_gate(
    page: Any,
    resume: Resume,
    *,
    approved_resume: Path | None = None,
    approvals: SmartApplyApprovals | None = None,
    permission_policy: ApplicationPermissionPolicy | None = None,
    verified_phone: str = "",
    phone_country_calling_code: str = "",
    phone_country_iso: str = "",
    question_plan: QuestionPlanningResult | None = None,
    human_approved_question_fingerprint: str = "",
    verification_queue: HumanVerificationQueue | None = None,
    application_reference: str = "",
    submission_history: (
        ApplicationSubmissionHistory | None | _DefaultSubmissionHistory
    ) = _DEFAULT_SUBMISSION_HISTORY,
    company: str = "",
    job_title: str = "",
    duplicate_window_days: int = 30,
    max_modules: int = 8,
) -> IndeedSmartApplyRunResult:
    """Advance known modules and stop at the next human or AI fallback gate."""
    gates = approvals or SmartApplyApprovals()
    policy = permission_policy or ApplicationPermissionPolicy()
    if isinstance(submission_history, _DefaultSubmissionHistory):
        submission_history = default_submission_history()
    seen: list[IndeedSmartApplyModule] = []
    executed: list[str] = []

    for _ in range(max(1, max_modules)):
        access = check_access_gate(page)
        module = classify_indeed_smart_apply_module(str(page.url))
        queue_reference = application_reference or str(page.url)
        if access.blocked:
            if verification_queue is not None:
                verification_queue.enqueue(
                    application_reference=queue_reference,
                    url=str(page.url),
                    result=access,
                )
            return IndeedSmartApplyRunResult(
                status=IndeedSmartApplyRunStatus.HUMAN_HANDOFF,
                module=module,
                modules_seen=seen,
                actions_executed=executed,
                stop_reason=f"access gate: {access.reason}",
            )
        if verification_queue is not None:
            verification_queue.resolve_if_clear(
                application_reference=queue_reference,
                url=str(page.url),
                result=access,
            )
        if module == IndeedSmartApplyModule.UNKNOWN:
            module = _wait_for_known_module(page)
        seen.append(module)
        if module == IndeedSmartApplyModule.UNKNOWN:
            return IndeedSmartApplyRunResult(
                status=IndeedSmartApplyRunStatus.HUMAN_HANDOFF,
                module=module,
                modules_seen=seen,
                actions_executed=executed,
                stop_reason="unknown module requires bounded AI sampling",
            )
        if module == IndeedSmartApplyModule.POST_APPLY:
            if not _wait_for_post_apply_confirmation(page):
                return IndeedSmartApplyRunResult(
                    status=IndeedSmartApplyRunStatus.HUMAN_HANDOFF,
                    module=module,
                    modules_seen=seen,
                    actions_executed=executed,
                    stop_reason=(
                        "post-apply route lacks the exact visible confirmation; "
                        "submission outcome is unknown and must not be retried"
                    ),
                )
            return IndeedSmartApplyRunResult(
                status=IndeedSmartApplyRunStatus.POST_APPLY,
                module=module,
                modules_seen=seen,
                actions_executed=executed,
                stop_reason="observable post-apply page reached",
            )
        if module == IndeedSmartApplyModule.QUESTIONS:
            observed_fingerprint = question_set_fingerprint(
                observe_indeed_screening_questions(page)
            )
            if human_approved_question_fingerprint:
                if observed_fingerprint != human_approved_question_fingerprint:
                    return IndeedSmartApplyRunResult(
                        status=IndeedSmartApplyRunStatus.HUMAN_HANDOFF,
                        module=module,
                        modules_seen=seen,
                        actions_executed=executed,
                        stop_reason="human questionnaire approval does not match the live page",
                    )
                if not _required_question_answers_present(page):
                    return IndeedSmartApplyRunResult(
                        status=IndeedSmartApplyRunStatus.GATE_REACHED,
                        module=module,
                        modules_seen=seen,
                        actions_executed=executed,
                        stop_reason="human-approved questionnaire has unanswered required fields",
                    )
                before = _page_observation(page)
                _first(page, "button:visible:has-text('Continue')").click()
                executed.append(f"{module.value}:human_approved_click")
                human_approved_question_fingerprint = ""
                transitioned, observed = _wait_for_transition(page, before)
                if not transitioned:
                    return IndeedSmartApplyRunResult(
                        status=IndeedSmartApplyRunStatus.HUMAN_HANDOFF,
                        module=module,
                        modules_seen=seen,
                        actions_executed=executed,
                        stop_reason="human-approved questionnaire did not advance",
                    )
                if observed[1] == IndeedSmartApplyModule.QUESTIONS:
                    return IndeedSmartApplyRunResult(
                        status=IndeedSmartApplyRunStatus.GATE_REACHED,
                        module=module,
                        modules_seen=seen,
                        actions_executed=executed,
                        stop_reason="next questionnaire page requires fresh inventory and planning",
                    )
                continue
            if question_plan is None or question_plan.unresolved or not question_plan.steps:
                return IndeedSmartApplyRunResult(
                    status=IndeedSmartApplyRunStatus.HUMAN_HANDOFF,
                    module=module,
                    modules_seen=seen,
                    actions_executed=executed,
                    stop_reason=(
                        "questionnaire requires an accepted evidence-grounded answer plan"
                    ),
                )
            domain = (urlsplit(str(page.url)).hostname or "").lower()
            for step in sorted(question_plan.steps, key=lambda item: item.step):
                if not policy.allows(step.action_class, domain=domain):
                    return IndeedSmartApplyRunResult(
                        status=IndeedSmartApplyRunStatus.GATE_REACHED,
                        module=module,
                        modules_seen=seen,
                        actions_executed=executed,
                        stop_reason=f"{step.action_class} permission required",
                    )
                _execute_question_step(page, step)
                executed.append(f"{module.value}:{step.action}")
            if not _required_question_answers_present(page):
                return IndeedSmartApplyRunResult(
                    status=IndeedSmartApplyRunStatus.GATE_REACHED,
                    module=module,
                    modules_seen=seen,
                    actions_executed=executed,
                    stop_reason="required questionnaire fields remain unanswered",
                )
            before = _page_observation(page)
            _first(page, "button:visible:has-text('Continue')").click()
            executed.append(f"{module.value}:click")
            question_plan = None
            transitioned, observed = _wait_for_transition(page, before)
            if not transitioned:
                validation = _visible_validation_reason(page)
                return IndeedSmartApplyRunResult(
                    status=IndeedSmartApplyRunStatus.HUMAN_HANDOFF,
                    module=module,
                    modules_seen=seen,
                    actions_executed=executed,
                    stop_reason=(
                        f"questionnaire validation remains unresolved: {validation}"
                        if validation
                        else "questionnaire transition was not observed; human review required"
                    ),
                )
            if observed[1] == IndeedSmartApplyModule.QUESTIONS:
                return IndeedSmartApplyRunResult(
                    status=IndeedSmartApplyRunStatus.GATE_REACHED,
                    module=module,
                    modules_seen=seen,
                    actions_executed=executed,
                    stop_reason="next questionnaire page requires fresh inventory and planning",
                )
            continue

        selected = _selected_resume(page, approved_resume)
        plan = build_indeed_smart_apply_plan(
            str(page.url),
            resume,
            field_values=_observe_fields(page, module),
            selected_resume=selected,
            approved_resume=approved_resume,
            approvals=gates,
            verified_phone=verified_phone,
            phone_country_calling_code=phone_country_calling_code,
            phone_country_iso=phone_country_iso,
        )
        if module == IndeedSmartApplyModule.REVIEW and not plan.browser_actions:
            return IndeedSmartApplyRunResult(
                status=IndeedSmartApplyRunStatus.REVIEW_READY,
                module=module,
                modules_seen=seen,
                actions_executed=executed,
                stop_reason=plan.stop_reason,
                selected_resume=plan.selected_resume,
            )
        if not plan.browser_actions:
            return IndeedSmartApplyRunResult(
                status=IndeedSmartApplyRunStatus.GATE_REACHED,
                module=module,
                modules_seen=seen,
                actions_executed=executed,
                stop_reason=plan.stop_reason or "no safe deterministic action",
                selected_resume=plan.selected_resume,
            )

        ordered_actions = sorted(plan.browser_actions, key=lambda item: item.step)
        for action in ordered_actions:
            domain = (urlsplit(str(page.url)).hostname or "").lower()
            if not policy.allows(action.action_class, domain=domain):
                return IndeedSmartApplyRunResult(
                    status=IndeedSmartApplyRunStatus.GATE_REACHED,
                    module=module,
                    modules_seen=seen,
                    actions_executed=executed,
                    stop_reason=f"{action.action_class} permission required",
                    selected_resume=plan.selected_resume,
                )

        submitted = any(
            action.action.lower().strip() == "final_submit" for action in ordered_actions
        )
        reservation_id: int | None = None
        if submitted:
            submit_selector = next(
                action.target
                for action in ordered_actions
                if action.action.lower().strip() == "final_submit"
            )
            pre_submit_gate = _wait_for_final_submit_gate(page, submit_selector)
            if not pre_submit_gate.allowed:
                if verification_queue is not None:
                    if pre_submit_gate.access.blocked:
                        verification_queue.enqueue(
                            application_reference=queue_reference,
                            url=str(page.url),
                            result=pre_submit_gate.access,
                        )
                return IndeedSmartApplyRunResult(
                    status=IndeedSmartApplyRunStatus.HUMAN_HANDOFF,
                    module=module,
                    modules_seen=seen,
                    actions_executed=executed,
                    stop_reason=f"final submit gate: {pre_submit_gate.reason}",
                    selected_resume=plan.selected_resume,
                )
        if submitted and submission_history is not None:
            if not company.strip() or not job_title.strip():
                return IndeedSmartApplyRunResult(
                    status=IndeedSmartApplyRunStatus.GATE_REACHED,
                    module=module,
                    modules_seen=seen,
                    actions_executed=executed,
                    stop_reason=("company and exact job title are required for submission history"),
                    selected_resume=plan.selected_resume,
                )
            reservation = submission_history.reserve_submission(
                company=company,
                job_title=job_title,
                source_url=str(page.url),
                within_days=duplicate_window_days,
            )
            if not reservation.allowed:
                reason = (
                    "confirmed exact company/title submission exists within "
                    f"{duplicate_window_days} days"
                    if reservation.decision == SubmissionDecision.RECENT_DUPLICATE
                    else "exact company/title has a recent unresolved submission attempt"
                )
                return IndeedSmartApplyRunResult(
                    status=IndeedSmartApplyRunStatus.SKIPPED_DUPLICATE,
                    module=module,
                    modules_seen=seen,
                    actions_executed=executed,
                    stop_reason=reason,
                    selected_resume=plan.selected_resume,
                )
            reservation_id = reservation.application_id

        before = _page_observation(page)
        for action in ordered_actions:
            if action.action.lower().strip() == "final_submit":
                final_gate = evaluate_final_submit_gate(page, action.target)
                if not final_gate.allowed:
                    if reservation_id is not None and submission_history is not None:
                        submission_history.mark_failed(
                            reservation_id,
                            details="final submit was not initiated because its gate was blocked",
                        )
                    if final_gate.access.blocked and verification_queue is not None:
                        verification_queue.enqueue(
                            application_reference=queue_reference,
                            url=str(page.url),
                            result=final_gate.access,
                        )
                    return IndeedSmartApplyRunResult(
                        status=IndeedSmartApplyRunStatus.HUMAN_HANDOFF,
                        module=module,
                        modules_seen=seen,
                        actions_executed=executed,
                        stop_reason=f"final submit gate: {final_gate.reason}",
                        selected_resume=plan.selected_resume,
                    )
            try:
                _execute_action(page, action)
            except Exception:
                if submission_history is not None and reservation_id is not None:
                    submission_history.mark_submission_unknown(
                        reservation_id,
                        details="browser action failed before observable confirmation",
                    )
                raise
            executed.append(f"{module.value}:{action.action}")

        if submitted:
            transitioned, _ = _wait_for_transition(page, before)
            if not transitioned:
                if submission_history is not None and reservation_id is not None:
                    submission_history.mark_submission_unknown(
                        reservation_id,
                        details="submission outcome was not observably confirmed",
                    )
                return IndeedSmartApplyRunResult(
                    status=IndeedSmartApplyRunStatus.FAILED,
                    module=module,
                    modules_seen=seen,
                    actions_executed=executed,
                    stop_reason="submission outcome was not observably confirmed; do not retry",
                    selected_resume=plan.selected_resume,
                )
            next_module = _wait_for_known_module(page)
            if (
                next_module == IndeedSmartApplyModule.POST_APPLY
                and _wait_for_post_apply_confirmation(page)
            ):
                if submission_history is not None and reservation_id is not None:
                    submission_history.mark_submitted(
                        reservation_id,
                        confirmation="observable post-apply page reached",
                    )
                return IndeedSmartApplyRunResult(
                    status=IndeedSmartApplyRunStatus.POST_APPLY,
                    module=next_module,
                    modules_seen=seen,
                    actions_executed=executed,
                    stop_reason="observable post-apply page reached",
                    selected_resume=plan.selected_resume,
                )
            if submission_history is not None and reservation_id is not None:
                submission_history.mark_submission_unknown(
                    reservation_id,
                    details="submit did not reach exact visible post-apply confirmation",
                )
            return IndeedSmartApplyRunResult(
                status=IndeedSmartApplyRunStatus.HUMAN_HANDOFF,
                module=next_module,
                modules_seen=seen,
                actions_executed=executed,
                stop_reason=(
                    "submit outcome lacks exact visible post-apply confirmation; do not retry"
                ),
                selected_resume=plan.selected_resume,
            )

        if plan.stop_reason:
            return IndeedSmartApplyRunResult(
                status=IndeedSmartApplyRunStatus.GATE_REACHED,
                module=module,
                modules_seen=seen,
                actions_executed=executed,
                stop_reason=plan.stop_reason,
                selected_resume=plan.selected_resume,
            )

        transitioned, _ = _wait_for_transition(page, before)
        if not transitioned:
            validation = _visible_validation_reason(page)
            return IndeedSmartApplyRunResult(
                status=IndeedSmartApplyRunStatus.HUMAN_HANDOFF,
                module=module,
                modules_seen=seen,
                actions_executed=executed,
                stop_reason=(
                    f"module validation remains unresolved: {validation}"
                    if validation
                    else "module transition was not observed; human review required"
                ),
                selected_resume=plan.selected_resume,
            )

    current = classify_indeed_smart_apply_module(str(page.url))
    return IndeedSmartApplyRunResult(
        status=IndeedSmartApplyRunStatus.HUMAN_HANDOFF,
        module=current,
        modules_seen=seen,
        actions_executed=executed,
        stop_reason="bounded module limit reached",
    )
