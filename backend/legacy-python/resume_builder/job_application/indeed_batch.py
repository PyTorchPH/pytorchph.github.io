"""Map Indeed Smart Apply results into the website-agnostic batch contract."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .access_verification import HumanVerificationQueue
from .batch import (
    BatchApplicationOutcome,
    BatchApplicationStatus,
    BatchApplicationTask,
)
from .indeed_smart_apply import (
    IndeedSmartApplyModule,
    classify_indeed_smart_apply_module,
)
from .indeed_smart_apply_runner import (
    IndeedSmartApplyRunResult,
    IndeedSmartApplyRunStatus,
)
from .shared import AccessGateResult, AccessGateState, check_access_gate
from .submission_history import (
    ApplicationSubmissionHistory,
    ConfirmationSource,
)

_POST_APPLY_CONFIRMATION = "your application has been submitted!"


def indeed_batch_outcome(
    task: BatchApplicationTask,
    result: IndeedSmartApplyRunResult,
) -> BatchApplicationOutcome:
    if result.status == IndeedSmartApplyRunStatus.POST_APPLY:
        status = BatchApplicationStatus.SUBMITTED
    elif result.status == IndeedSmartApplyRunStatus.SKIPPED_DUPLICATE:
        status = BatchApplicationStatus.SKIPPED
    elif result.status == IndeedSmartApplyRunStatus.FAILED:
        status = BatchApplicationStatus.FAILED
    elif result.status == IndeedSmartApplyRunStatus.HUMAN_HANDOFF and any(
        marker in result.stop_reason.casefold()
        for marker in ("captcha", "verification_required", "access gate")
    ):
        status = BatchApplicationStatus.VERIFICATION_PENDING
    else:
        status = BatchApplicationStatus.HUMAN_HANDOFF
    return BatchApplicationOutcome(
        task=task,
        status=status,
        detail=result.stop_reason,
    )


def reconcile_indeed_post_apply(
    page: Any,
    task: BatchApplicationTask,
    *,
    verification_queue: HumanVerificationQueue,
    submission_history: ApplicationSubmissionHistory,
    observed_at: datetime | None = None,
) -> BatchApplicationOutcome | None:
    """Persist a human-completed submission from deterministic post-apply proof.

    Returns ``None`` while the page has not reached the known post-apply route.
    A route without the exact visible confirmation fails closed.
    """
    if (
        classify_indeed_smart_apply_module(str(page.url))
        != IndeedSmartApplyModule.POST_APPLY
    ):
        return None
    access = check_access_gate(page)
    if access.blocked:
        return BatchApplicationOutcome(
            task=task,
            status=BatchApplicationStatus.VERIFICATION_PENDING,
            detail=f"post-apply access gate: {access.reason}",
        )
    body = page.locator("body").first
    visible_text = body.inner_text().casefold() if body.count() else ""
    if _POST_APPLY_CONFIRMATION not in visible_text:
        return BatchApplicationOutcome(
            task=task,
            status=BatchApplicationStatus.FAILED,
            detail="post-apply route lacks visible submission confirmation",
        )

    submission_history.record_existing_submission(
        company=task.company,
        job_title=task.job_title,
        applied_at=observed_at or datetime.now(timezone.utc),
        confirmation="observable Indeed post-apply page reached",
        confirmation_source=ConfirmationSource.BROWSER,
        source_url=str(page.url),
    )
    reference = task.application_reference or f"{task.company} — {task.job_title}"
    verification_queue.resolve_if_clear(
        application_reference=reference,
        url=str(page.url),
        result=AccessGateResult(state=AccessGateState.CLEAR),
    )
    return BatchApplicationOutcome(
        task=task,
        status=BatchApplicationStatus.SUBMITTED,
        detail="observable Indeed post-apply page reached",
    )
