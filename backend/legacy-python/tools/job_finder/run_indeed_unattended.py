"""Run a bounded explicit Indeed application batch in independent Chrome/CDP pages."""

from __future__ import annotations

import argparse
import heapq
import json
import os
import sys
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from urllib.parse import urlsplit

import requests

ROOT = next(path for path in Path(__file__).resolve().parents if (path / "pyproject.toml").exists())
sys.path.insert(0, str(ROOT / "legacy" / "python"))

from resume_builder.job_application import (  # noqa: E402
    ApplicationProfileStore,
    ApplicationGoalStatus,
    ApplicationGoalStore,
    ApplicationPermissionPolicy,
    ApplicationSubmissionHistory,
    BatchApplicationOutcome,
    BatchApplicationStatus,
    BrowserResourceLimits,
    HumanVerificationQueue,
    GoalItemState,
    InterventionAction,
    AccessGateResult,
    AccessGateState,
    ApprovedIndeedQuestionAnswers,
    ApprovedIndeedQuestionAnswerSet,
    DEFAULT_MONGODB_DATABASE,
    DEFAULT_MONGODB_URI,
    DevelopmentQuestionBridge,
    MongoQuestionnaireRepository,
    ResumeArtifactProfile,
    VerificationQueueGroup,
    SmartApplyApprovals,
    SmartApplyNovelQuestionAnswerer,
    VerifiedApplicationProfile,
    build_adaptive_indeed_question_plan,
    check_access_gate,
    indeed_batch_outcome,
    calculate_browser_resource_limits,
    load_resume_artifact,
    observe_indeed_screening_questions,
    question_set_fingerprint,
    read_browser_resource_snapshot,
    recommend_role_resume,
    run_indeed_smart_apply_until_gate,
    SalaryBand,
    parse_salary_signal,
)
from resume_builder.llm import GoogleProvider, LLMUnavailableError  # noqa: E402
from resume_builder.job_application.indeed_unattended import (  # noqa: E402
    IndeedUnattendedJob,
    IndeedUnattendedManifest,
    description_is_allowed,
    has_recent_exact_submission,
)
from resume_builder.job_application.dynamic_layout_runtime import (  # noqa: E402
    capture_unknown_application_layout,
)

_WRITE_LOCK = Lock()
_APPLY_SELECTORS = (
    "[data-testid=indeedApplyButton]",
    "button:visible:has-text('Apply on company site')",
    "a:visible:has-text('Apply on company site')",
    "button:visible:has-text('Apply now')",
    "button:visible:has-text('Apply with Indeed')",
    "a:visible:has-text('Apply now')",
)


def _write_json(path: Path, value: object) -> None:
    with _WRITE_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(value, indent=2), encoding="utf-8")
        temporary.replace(path)


def _append_jsonl(path: Path, value: object) -> None:
    with _WRITE_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(value, ensure_ascii=False) + "\n")


def _outcome(
    job: IndeedUnattendedJob,
    status: BatchApplicationStatus,
    detail: str,
) -> BatchApplicationOutcome:
    return BatchApplicationOutcome(task=job.batch_task(), status=status, detail=detail)


def _should_delay_for_human(outcome: BatchApplicationOutcome) -> bool:
    if outcome.status == BatchApplicationStatus.VERIFICATION_PENDING:
        return True
    return outcome.status == BatchApplicationStatus.HUMAN_HANDOFF and any(
        marker in outcome.detail.casefold()
        for marker in (
            "validation remains unresolved",
            "questionnaire requires an accepted evidence-grounded answer plan",
        )
    )


def _record_goal_outcome(
    args: argparse.Namespace,
    outcome: BatchApplicationOutcome,
    job: IndeedUnattendedJob | None = None,
) -> None:
    goal_id = str(getattr(args, "goal_id", "") or "").strip()
    if not goal_id:
        return
    store = ApplicationGoalStore(Path(args.database))
    task = outcome.task
    try:
        existing = store.item(goal_id, task.task_id)
    except KeyError:
        existing = None
    salary_signal = job.salary_signal if job else ""
    salary_min = job.salary_monthly_min_php if job else None
    salary_max = job.salary_monthly_max_php if job else None
    salary_band = job.salary_band if job else SalaryBand.LEGACY
    if existing is not None and salary_band == SalaryBand.UNKNOWN:
        salary_signal = existing.salary_signal
        salary_min = existing.salary_monthly_min_php
        salary_max = existing.salary_monthly_max_php
        salary_band = existing.salary_band
    state = {
        BatchApplicationStatus.SUBMITTED: GoalItemState.OBSERVED,
        BatchApplicationStatus.SKIPPED: GoalItemState.SKIPPED,
        BatchApplicationStatus.FAILED: GoalItemState.FAILED,
        BatchApplicationStatus.VERIFICATION_PENDING: GoalItemState.HUMAN_HANDOFF,
        BatchApplicationStatus.HUMAN_HANDOFF: GoalItemState.HUMAN_HANDOFF,
    }[outcome.status]
    store.observe(
        goal_id,
        task_id=task.task_id,
        site="indeed",
        company=task.company,
        job_title=task.job_title,
        state=state,
        detail=outcome.detail,
        salary_signal=salary_signal,
        salary_monthly_min_php=salary_min,
        salary_monthly_max_php=salary_max,
        salary_band=salary_band,
        job_level=job.job_level if job else "unknown",
    )
    if outcome.status == BatchApplicationStatus.SUBMITTED:
        store.confirm(goal_id, task.task_id, detail=outcome.detail)
    elif outcome.status == BatchApplicationStatus.HUMAN_HANDOFF and any(
        marker in outcome.detail.casefold()
        for marker in ("review", "final submit", "submit permission")
    ):
        store.reserve(goal_id, task.task_id)
    elif outcome.status in {BatchApplicationStatus.SKIPPED, BatchApplicationStatus.FAILED}:
        store.release(goal_id, task.task_id, state=state, detail=outcome.detail)


def _check_access(page, job, queue, *, goal_id: str = ""):
    reference = job.batch_task().application_reference
    access = check_access_gate(page)
    if not access.blocked:
        queue.resolve_if_clear(
            application_reference=reference,
            url=str(page.url),
            result=access,
        )
        return access
    host = (urlsplit(str(page.url)).hostname or "").lower()
    matching_pending = [
        item
        for item in queue.pending()
        if item.application_reference == reference and item.domain == host
    ]
    target_id = _browser_target_id(page)
    pending_target_ids = {
        item.browser_target_id for item in matching_pending if item.browser_target_id
    }
    if not matching_pending or (target_id and target_id not in pending_target_ids):
        queue.enqueue(
            application_reference=reference,
            url=str(page.url),
            result=access,
            browser_target_id=target_id,
            task_id=job.task_id,
            company=job.company,
            job_title=job.job_title,
            goal_id=goal_id,
            resume_file=job.resume_file,
        )
    return access


def _browser_target_id(page) -> str:
    """Return Chrome's non-secret page identity for exact human-handoff resume."""
    session = None
    try:
        session = page.context.new_cdp_session(page)
        result = session.send("Target.getTargetInfo")
        return str(result.get("targetInfo", {}).get("targetId", ""))
    except Exception:
        return ""
    finally:
        if session is not None:
            try:
                session.detach()
            except Exception:
                pass


def _visible_text(page, selector: str) -> str:
    locator = page.locator(selector).first
    return locator.inner_text() if locator.count() and locator.is_visible() else ""


def _rendered_salary_signal(page) -> str:
    for selector in (
        "#salaryInfoAndJobType",
        "[data-testid=attribute_snippet_testid]",
        ".salary-snippet-container",
        "[class*=salary]",
    ):
        value = _visible_text(page, selector)
        if value and ("₱" in value or "PHP" in value.upper()):
            return value
    return ""


def _observe_job_evidence(args: argparse.Namespace, job: IndeedUnattendedJob) -> None:
    goal_id = str(getattr(args, "goal_id", "") or "").strip()
    if not goal_id:
        return
    ApplicationGoalStore(Path(args.database)).observe(
        goal_id,
        task_id=job.task_id,
        site="indeed",
        company=job.company,
        job_title=job.job_title,
        salary_signal=job.salary_signal,
        salary_monthly_min_php=job.salary_monthly_min_php,
        salary_monthly_max_php=job.salary_monthly_max_php,
        salary_band=job.salary_band,
        job_level=job.job_level,
        detail="rendered listing evidence classified",
    )


def _human_review_approved(args: argparse.Namespace, job: IndeedUnattendedJob) -> bool:
    goal_id = str(getattr(args, "goal_id", "") or "").strip()
    if not goal_id:
        return False
    try:
        return (
            ApplicationGoalStore(Path(args.database))
            .item(goal_id, job.task_id)
            .human_review_approved
        )
    except KeyError:
        return False


def _tab_budget_available(context, args: argparse.Namespace) -> bool:
    max_tabs = int(getattr(args, "max_tabs", 0) or 0)
    baseline_tabs = int(getattr(args, "baseline_tabs", 0) or 0)
    worker_owned_tabs = max(0, len(context.pages) - baseline_tabs)
    return not max_tabs or worker_owned_tabs < max_tabs


def _tab_budget_detail(context, args: argparse.Namespace) -> str:
    baseline_tabs = int(getattr(args, "baseline_tabs", 0) or 0)
    worker_owned_tabs = max(0, len(context.pages) - baseline_tabs)
    return (
        f"worker tab budget reached ({worker_owned_tabs}/{args.max_tabs}; "
        f"baseline browser tabs={baseline_tabs})"
    )


def _browser_page_count(cdp_url: str) -> int:
    response = requests.get(f"{cdp_url.rstrip('/')}/json", timeout=3)
    response.raise_for_status()
    payload = response.json()
    return sum(
        isinstance(item, dict) and item.get("type") == "page"
        for item in payload
        if isinstance(item, dict)
    )


def _wait_for_listing_evidence(
    page,
    job: IndeedUnattendedJob,
    *,
    timeout_ms: int = 10_000,
    poll_ms: int = 250,
) -> tuple[str, str]:
    """Wait for hydrated identity and description before qualification checks."""
    expected_company = " ".join(job.company.casefold().split())
    expected_title = " ".join(job.job_title.casefold().split())
    waited_ms = 0
    body_text = ""
    description = ""
    while True:
        try:
            body_text = _visible_text(page, "body")
            description = _visible_text(page, "#jobDescriptionText")
        except Exception:
            body_text = ""
            description = ""
        normalized_body = " ".join(body_text.casefold().split())
        if (
            expected_company in normalized_body
            and expected_title in normalized_body
            and description.strip()
        ):
            return body_text, description
        if waited_ms >= timeout_ms:
            return body_text, description
        delay_ms = min(poll_ms, timeout_ms - waited_ms)
        page.wait_for_timeout(delay_ms)
        waited_ms += delay_ms


def _visible_apply_control(page, *, timeout_ms: int, poll_ms: int):
    waited_ms = 0
    while True:
        for selector in _APPLY_SELECTORS:
            candidate = page.locator(selector).first
            if candidate.count() and candidate.is_visible():
                return candidate
        if waited_ms >= timeout_ms:
            return None
        delay_ms = min(poll_ms, timeout_ms - waited_ms)
        page.wait_for_timeout(delay_ms)
        waited_ms += delay_ms


def _open_apply_destination(
    page,
    context,
    *,
    control_timeout_ms: int = 10_000,
    navigation_timeout_ms: int = 15_000,
    poll_ms: int = 250,
):
    before_pages = tuple(context.pages)
    initial_host = (urlsplit(str(page.url)).hostname or "").lower()
    apply_control = _visible_apply_control(
        page,
        timeout_ms=control_timeout_ms,
        poll_ms=poll_ms,
    )
    if apply_control is None:
        return None, "no verified visible Indeed Apply control"

    # Click exactly once. A new Indeed Apply page commonly exists as about:blank
    # before its real navigation starts, so do not classify the first URL.
    apply_control.click()
    waited_ms = 0
    application_page = page
    while True:
        new_pages = [
            candidate
            for candidate in context.pages
            if all(candidate is not existing for existing in before_pages)
        ]
        candidates = [*reversed(new_pages), page]
        for candidate in candidates:
            host = (urlsplit(str(candidate.url)).hostname or "").lower()
            if host == "smartapply.indeed.com":
                return candidate, ""
            if (
                host
                and host != initial_host
                and host != "indeed.com"
                and not host.endswith(".indeed.com")
            ):
                return candidate, f"apply on company site: {host}"
        if new_pages:
            application_page = new_pages[-1]
        if waited_ms >= navigation_timeout_ms:
            break
        delay_ms = min(poll_ms, navigation_timeout_ms - waited_ms)
        page.wait_for_timeout(delay_ms)
        waited_ms += delay_ms

    host = (urlsplit(str(application_page.url)).hostname or "").lower()
    return (
        application_page,
        f"apply control did not reach Indeed Smart Apply: {host or 'unknown'}",
    )


def _queue_company_site_handoff(
    page,
    job: IndeedUnattendedJob,
    queue: HumanVerificationQueue,
    *,
    goal_id: str = "",
) -> BatchApplicationOutcome:
    queue.enqueue(
        application_reference=job.batch_task().application_reference,
        url=str(page.url),
        result=AccessGateResult(
            state=AccessGateState.HUMAN_REQUIRED,
            reason="apply_on_company_site",
            evidence="Indeed Apply opened an external company application site",
        ),
        browser_target_id=_browser_target_id(page),
        group=VerificationQueueGroup.HUMAN_INTERVENTION,
        task_id=job.task_id,
        company=job.company,
        job_title=job.job_title,
        goal_id=goal_id,
        resume_file=job.resume_file,
    )
    return _outcome(
        job,
        BatchApplicationStatus.HUMAN_HANDOFF,
        "human intervention required: apply on company site",
    )


def _is_pending_company_site_handoff(
    page,
    job: IndeedUnattendedJob,
    queue: HumanVerificationQueue,
) -> bool:
    target_id = _browser_target_id(page)
    reference = job.batch_task().application_reference
    return any(
        item.application_reference == reference
        and item.group == VerificationQueueGroup.HUMAN_INTERVENTION
        and (not item.browser_target_id or item.browser_target_id == target_id)
        for item in queue.pending()
    )


def _profile_store(args: argparse.Namespace) -> ApplicationProfileStore:
    path = getattr(args, "profile_database", None) or getattr(
        args,
        "database",
        ROOT / "var" / "state" / "job-applications" / "submissions.sqlite3",
    )
    return ApplicationProfileStore(Path(path))


def _select_resume(
    job: IndeedUnattendedJob,
    args: argparse.Namespace,
    description: str,
) -> Path | None:
    if job.resume_file:
        candidate = args.artifact_dir / job.resume_file
        return candidate if candidate.is_file() else None
    routes = _profile_store(args).resume_routes()
    profiles = tuple(
        ResumeArtifactProfile(filename=route.filename, terms=route.terms) for route in routes
    )
    default_filename = next(
        (route.filename for route in routes if route.is_default),
        None,
    )
    return recommend_role_resume(
        job.job_title,
        args.artifact_dir,
        job_description=description,
        profiles=profiles,
        default_filename=default_filename,
    )


def _qualification_evidence(job: IndeedUnattendedJob, description: str) -> str:
    """Combine the exact rendered title with the full description for literal rules."""
    return "\n".join(part for part in (job.job_title.strip(), description.strip()) if part)


def _application_location(page, job: IndeedUnattendedJob) -> str:
    """Read the location paired with the exact company in the Smart Apply header."""
    try:
        header = _visible_text(page, ".ia-JobHeader")
    except Exception:
        return ""
    company = " ".join(job.company.casefold().split())
    for line in reversed(header.splitlines()):
        normalized = " ".join(line.casefold().split())
        if company not in normalized:
            continue
        for separator in (" - ", " – ", " — "):
            prefix, found, location = line.partition(separator)
            if found and company in " ".join(prefix.casefold().split()):
                return location.strip()
    return ""


def _runtime_question_profile(
    page,
    job: IndeedUnattendedJob,
    questions,
    approved_questions: ApprovedIndeedQuestionAnswerSet | None,
) -> ApprovedIndeedQuestionAnswers | None:
    approved = approved_questions.matching(questions) if approved_questions else None
    location = _application_location(page, job)
    location_labels = {
        question.label
        for question in questions
        if question.label.casefold().strip() == "which location are you applying for?"
    }
    if not location or not location_labels:
        return approved
    answers = dict(approved.answers) if approved else {}
    for label in location_labels:
        answers[label] = location
    return ApprovedIndeedQuestionAnswers(
        question_set_fingerprint=question_set_fingerprint(questions),
        answers=answers,
    )


def _runtime_verified_phone(page, args: argparse.Namespace, identity=None) -> str:
    """Use an explicit phone or the matching saved contact value visible in Indeed."""
    explicit = (
        getattr(args, "verified_phone", "")
        or os.environ.get("PYTORCH_PH_VERIFIED_PHONE", "")
        or (identity.verified_phone if identity else "")
    )
    if explicit:
        return explicit
    if "/contact-info-module" not in urlsplit(str(page.url)).path:
        return ""
    phone = page.locator("input[name=phone], input[type=tel]").first
    country = page.locator("[role=combobox][aria-haspopup=listbox]").first
    if not phone.count() or not country.count():
        return ""
    value = phone.input_value().strip()
    observed_iso = (country.get_attribute("data-value") or "").strip().upper()
    expected_iso = (
        (getattr(args, "phone_country_iso", "") or (identity.country_iso if identity else ""))
        .strip()
        .upper()
    )
    original_calling_code = "".join(
        character
        for character in getattr(args, "saved_phone_original_calling_code", "")
        if character.isdigit()
    )
    if (
        not original_calling_code
        and observed_iso != expected_iso
        and getattr(args, "use_saved_contact_phone", False)
    ):
        original_calling_code = "".join(
            character for character in country.inner_text() if character.isdigit()
        )
    visible_digits = "".join(character for character in value if character.isdigit())
    if original_calling_code and visible_digits.startswith(original_calling_code):
        return visible_digits[len(original_calling_code) :]
    if value and observed_iso == expected_iso:
        return value
    if value and observed_iso and getattr(args, "use_saved_contact_phone", False):
        return value
    return ""


def _resume_with_verified_identity(resume, identity):
    """Overlay one SQLite-verified contact identity onto the runtime resume."""
    if identity is None:
        return resume
    contact_updates = {
        "name": identity.full_name,
        "location": identity.country_name,
    }
    if identity.verified_phone:
        contact_updates["phone"] = identity.verified_phone
    return resume.model_copy(
        update={
            "contact": resume.contact.model_copy(update=contact_updates),
        }
    )


def _question_ai_answerer(args: argparse.Namespace, resume, application_preferences):
    if getattr(args, "question_ai_provider", "google") == "off":
        return None
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None
    provider = GoogleProvider(
        api_key=api_key,
        model=getattr(args, "question_ai_model", "gemini-3.1-pro-preview"),
    )
    return SmartApplyNovelQuestionAnswerer(
        provider,
        resume,
        application_preferences=application_preferences,
    )


def _adaptive_question_page_plan(
    page,
    job: IndeedUnattendedJob,
    args: argparse.Namespace,
    resume,
    *,
    verified_phone: str,
    approved_questions: ApprovedIndeedQuestionAnswerSet | None,
):
    questions = observe_indeed_screening_questions(page)
    exact = _runtime_question_profile(
        page,
        job,
        questions,
        approved_questions,
    )
    repository = _open_questionnaire_repository(args)
    try:
        reusable = (
            repository.reusable_answers(questions, domain="smartapply.indeed.com")
            if repository is not None
            else {}
        )
        application_preferences = repository.profile_values() if repository is not None else {}
        profile = VerifiedApplicationProfile(
            email=resume.contact.email or "",
            phone=verified_phone,
            country=resume.contact.location or "",
        )
        try:
            adaptive = build_adaptive_indeed_question_plan(
                questions,
                resume=resume,
                verified_profile=profile,
                exact=exact,
                reusable_answers=reusable,
                application_preferences=application_preferences,
                answerer=_question_ai_answerer(
                    args,
                    resume,
                    application_preferences,
                ),
            )
        except (LLMUnavailableError, ValueError) as exc:
            print(
                f"Question AI unavailable; deterministic/Mongo answers retained: {exc}",
                flush=True,
            )
            adaptive = build_adaptive_indeed_question_plan(
                questions,
                resume=resume,
                verified_profile=profile,
                exact=exact,
                reusable_answers=reusable,
                application_preferences=application_preferences,
            )
        if repository is not None:
            repository.save_observed_page(
                questions,
                adaptive.persistable_answers,
                domain="smartapply.indeed.com",
                source="validated adaptive Smart Apply question bank",
            )
    finally:
        if repository is not None:
            repository.close()
    summary_payload = {
        **adaptive.summary.model_dump(mode="json"),
        "company": job.company,
        "job_title": job.job_title,
    }
    print(
        "Smart Apply page context: " + json.dumps(summary_payload, ensure_ascii=False),
        flush=True,
    )
    _append_jsonl(
        args.output / "questionnaire-pages.jsonl",
        summary_payload,
    )
    if adaptive.plan.unresolved:
        unresolved = set(adaptive.plan.unresolved)
        unresolved_questions = [
            question for question in questions if question.question_id in unresolved
        ]
        DevelopmentQuestionBridge(ROOT / "out" / "development-question-bridge").create_request(
            domain="smartapply.indeed.com",
            company=job.company,
            job_title=job.job_title,
            questions=unresolved_questions,
            resume=resume,
        )
        _append_jsonl(
            args.output / "development-question-requests.jsonl",
            {
                "schema_version": 1,
                "development_only": True,
                "company": job.company,
                "job_title": job.job_title,
                "questions": [
                    question.model_dump(mode="json") for question in unresolved_questions
                ],
            },
        )
    return adaptive.plan


def _matching_existing_page(
    context,
    job: IndeedUnattendedJob,
    queue: HumanVerificationQueue | None = None,
):
    listing_url = job.listing_url.rstrip("/")
    company = " ".join(job.company.casefold().split())
    title = " ".join(job.job_title.casefold().split())
    pending_target_ids = {
        entry.browser_target_id
        for entry in (queue.pending() if queue is not None else [])
        if entry.application_reference == job.batch_task().application_reference
        and entry.browser_target_id
    }
    if pending_target_ids:
        for page in reversed(context.pages):
            if _browser_target_id(page) in pending_target_ids:
                host = (urlsplit(str(page.url)).hostname or "").lower()
                return page, host == "smartapply.indeed.com"
    for page in reversed(context.pages):
        if (urlsplit(str(page.url)).hostname or "").lower() != "smartapply.indeed.com":
            continue
        try:
            body = " ".join(_visible_text(page, "body").casefold().split())
        except Exception:
            continue
        if company in body and title in body:
            return page, True
    for page in reversed(context.pages):
        if str(page.url).rstrip("/") == listing_url:
            return page, False
    return None, False


def _application_permissions(
    args: argparse.Namespace,
) -> tuple[ApplicationPermissionPolicy, SmartApplyApprovals]:
    safe_draft_only = bool(getattr(args, "safe_draft_only", False))
    assisted_apply = bool(getattr(args, "assisted_apply", False))
    return (
        ApplicationPermissionPolicy(
            autonomous_draft_writes=True,
            autonomous_sensitive_writes=assisted_apply or not safe_draft_only,
            autonomous_submit=getattr(args, "autonomous_submit", False),
            allowed_domains={"smartapply.indeed.com"},
        ),
        SmartApplyApprovals(
            resume_upload=not safe_draft_only and not assisted_apply,
            resume_continue=not safe_draft_only and not assisted_apply,
            final_submit=getattr(args, "autonomous_submit", False),
        ),
    )


def _run_application(
    application_page,
    job: IndeedUnattendedJob,
    args: argparse.Namespace,
    queue: HumanVerificationQueue,
    history: ApplicationSubmissionHistory,
    *,
    description: str,
) -> BatchApplicationOutcome:
    goal_id = str(getattr(args, "goal_id", "") or "")
    application_access = _check_access(application_page, job, queue, goal_id=goal_id)
    if application_access.blocked:
        return _outcome(
            job,
            BatchApplicationStatus.VERIFICATION_PENDING,
            f"application access gate remains pending: {application_access.reason}",
        )
    store = _profile_store(args)
    identity = store.verified_identity()
    resume_path = _select_resume(job, args, description)
    if resume_path is None:
        return _outcome(
            job,
            BatchApplicationStatus.HUMAN_HANDOFF,
            "no approved real role-specific resume artifact is available",
        )
    resume_json = resume_path.with_suffix(".resume.json")
    if not resume_json.is_file():
        return _outcome(
            job,
            BatchApplicationStatus.HUMAN_HANDOFF,
            f"resume evidence JSON is missing for {resume_path.name}",
        )
    resume = load_resume_artifact(resume_json)
    resume = _resume_with_verified_identity(resume, identity)
    verified_phone = _runtime_verified_phone(application_page, args, identity)
    phone_country_calling_code = getattr(args, "phone_country_calling_code", "") or (
        identity.phone_calling_code if identity else ""
    )
    phone_country_iso = getattr(args, "phone_country_iso", "") or (
        identity.country_iso if identity else ""
    )
    policy, approvals = _application_permissions(args)
    application_reference = job.batch_task().application_reference
    upload_approval = queue.approved_action(
        application_reference=application_reference,
        action=InterventionAction.RESUME_UPLOAD,
    )
    continue_approval = queue.approved_action(
        application_reference=application_reference,
        action=InterventionAction.RESUME_CONTINUE,
    )
    if bool(getattr(args, "assisted_apply", False)):
        approvals = approvals.model_copy(
            update={
                "resume_upload": upload_approval is not None,
                "resume_continue": continue_approval is not None,
            }
        )
    result = None
    approved_questions = _load_approved_questions(args)
    for _ in range(8):
        question_plan = None
        question_approval = None
        if "/questions-module" in urlsplit(str(application_page.url)).path:
            observed_questions = observe_indeed_screening_questions(application_page)
            question_approval = queue.approved_question(
                application_reference=job.batch_task().application_reference,
                browser_target_id=_browser_target_id(application_page),
                question_fingerprint=question_set_fingerprint(observed_questions),
            )
            if bool(getattr(args, "safe_draft_only", False)):
                queue.enqueue_handoff(
                    application_reference=application_reference,
                    url=str(application_page.url),
                    reason="safe_draft_questionnaire_gate",
                    browser_target_id=_browser_target_id(application_page),
                    action=InterventionAction.UNKNOWN_QUESTION,
                    question_labels=[question.label for question in observed_questions],
                    task_id=job.task_id,
                    company=job.company,
                    job_title=job.job_title,
                    goal_id=goal_id,
                    resume_file=resume_path.name,
                )
                return _outcome(
                    job,
                    BatchApplicationStatus.HUMAN_HANDOFF,
                    "safe draft mode stops before questionnaires",
                )
            if question_approval is None:
                question_plan = _adaptive_question_page_plan(
                    application_page,
                    job,
                    args,
                    resume,
                    verified_phone=verified_phone,
                    approved_questions=approved_questions,
                )
            if question_plan is not None and question_plan.unresolved:
                unresolved = set(question_plan.unresolved)
                queue.enqueue_handoff(
                    application_reference=job.batch_task().application_reference,
                    url=str(application_page.url),
                    reason="unknown_question",
                    browser_target_id=_browser_target_id(application_page),
                    action=InterventionAction.UNKNOWN_QUESTION,
                    question_labels=[
                        question.label
                        for question in observed_questions
                        if question.question_id in unresolved
                    ],
                    task_id=job.task_id,
                    company=job.company,
                    job_title=job.job_title,
                    goal_id=goal_id,
                    resume_file=resume_path.name,
                )
        else:
            queue.resolve_matching(
                application_reference=job.batch_task().application_reference,
                action=InterventionAction.UNKNOWN_QUESTION,
            )
        result = run_indeed_smart_apply_until_gate(
            application_page,
            resume,
            approved_resume=resume_path,
            approvals=approvals,
            permission_policy=policy,
            verified_phone=verified_phone,
            phone_country_calling_code=phone_country_calling_code,
            phone_country_iso=phone_country_iso,
            question_plan=question_plan,
            human_approved_question_fingerprint=(
                question_approval.question_fingerprint if question_approval is not None else ""
            ),
            verification_queue=queue,
            application_reference=job.batch_task().application_reference,
            submission_history=history,
            company=job.company,
            job_title=job.job_title,
            duplicate_window_days=args.duplicate_days,
        )
        if (
            question_approval is not None
            and "questions:human_approved_click" in result.actions_executed
        ):
            queue.consume_question_approval(question_approval.id)
        repeatable_gate = any(
            marker in result.stop_reason
            for marker in (
                "stop after upload",
                "next questionnaire page requires fresh inventory and planning",
            )
        )
        if result.status.value != "gate_reached" or not repeatable_gate:
            break
        application_page.wait_for_timeout(2_000)
    if result is None:
        return _outcome(job, BatchApplicationStatus.FAILED, "runner produced no result")
    if upload_approval is not None and "resume:upload" in result.actions_executed:
        queue.consume_action(upload_approval.id)
    if continue_approval is not None and "resume:click" in result.actions_executed:
        queue.consume_action(continue_approval.id)
    if "unknown module" in result.stop_reason.casefold():
        layout_dir = Path(args.output) / "layouts" / job.task_id
        layout = capture_unknown_application_layout(
            application_page,
            output_dir=layout_dir,
            cache_dir=ROOT / "var" / "cache" / "job-applications" / "layout-rules",
        )
        queue.enqueue_handoff(
            application_reference=application_reference,
            url=str(application_page.url),
            reason="layout_review",
            browser_target_id=_browser_target_id(application_page),
            action=InterventionAction.LAYOUT_REVIEW,
            task_id=job.task_id,
            company=job.company,
            job_title=job.job_title,
            goal_id=goal_id,
            resume_file=resume_path.name,
            layout_fingerprint=str(layout.get("layout_fingerprint", "")),
            artifact_path=str(layout_dir.relative_to(ROOT)),
        )
        result.stop_reason = (
            "unknown application layout captured; "
            + str(layout.get("status", "human review required")).replace("_", " ")
        )
    resume_gate = None
    if "approval required to upload" in result.stop_reason:
        resume_gate = InterventionAction.RESUME_UPLOAD
    elif any(
        marker in result.stop_reason
        for marker in (
            "uploaded resume preview requires human approval",
            "stop after upload for human preview",
        )
    ):
        resume_gate = InterventionAction.RESUME_CONTINUE
    if resume_gate is not None:
        queue.enqueue_handoff(
            application_reference=application_reference,
            url=str(application_page.url),
            reason=resume_gate.value,
            browser_target_id=_browser_target_id(application_page),
            action=resume_gate,
            task_id=job.task_id,
            company=job.company,
            job_title=job.job_title,
            goal_id=goal_id,
            resume_file=resume_path.name,
        )
    return indeed_batch_outcome(job.batch_task(), result)


def _load_approved_questions(
    args: argparse.Namespace,
) -> ApprovedIndeedQuestionAnswerSet | None:
    source = getattr(args, "questionnaire_store", "") or "auto"
    approved_answers = getattr(args, "approved_answers", None)
    if source == "json":
        json_path = approved_answers or getattr(args, "questionnaire_json_fallback", None)
        if json_path is None:
            raise ValueError("--approved-answers is required for questionnaire-store=json")
        return _load_questionnaire_json(Path(json_path))
    if source not in {"auto", "mongodb"}:
        raise ValueError(f"unsupported questionnaire store: {source}")
    repository = _open_questionnaire_repository(args, required=source == "mongodb")
    try:
        answer_set = (
            repository.load(domain="smartapply.indeed.com") if repository is not None else None
        )
    finally:
        if repository is not None:
            repository.close()
    if answer_set is not None or source == "mongodb":
        return answer_set
    fallback = approved_answers or getattr(args, "questionnaire_json_fallback", None)
    return _load_questionnaire_json(Path(fallback)) if fallback and Path(fallback).is_file() else None


def _load_questionnaire_json(path: Path) -> ApprovedIndeedQuestionAnswerSet:
    return ApprovedIndeedQuestionAnswerSet.model_validate_json(path.read_text(encoding="utf-8"))


def _open_questionnaire_repository(args: argparse.Namespace, *, required: bool = False):
    repository = None
    try:
        repository = MongoQuestionnaireRepository(
            getattr(args, "mongodb_uri", DEFAULT_MONGODB_URI),
            database=getattr(args, "mongodb_database", DEFAULT_MONGODB_DATABASE),
        )
        repository.ping()
        return repository
    except Exception as exc:  # noqa: BLE001 - optional local store degrades to reviewed JSON
        if repository is not None:
            repository.close()
        if required:
            raise
        print(
            f"Question bank MongoDB unavailable; using approved JSON fallback: {type(exc).__name__}",
            flush=True,
        )
        return None


def _retire_if_terminal(page, outcome: BatchApplicationOutcome) -> BatchApplicationOutcome:
    if outcome.status in {
        BatchApplicationStatus.SKIPPED,
        BatchApplicationStatus.SUBMITTED,
    }:
        try:
            page.close()
        except Exception:
            pass
    return outcome


def _worker(job: IndeedUnattendedJob, args: argparse.Namespace) -> BatchApplicationOutcome:
    from playwright.sync_api import sync_playwright

    queue = HumanVerificationQueue(args.queue)
    history = ApplicationSubmissionHistory(args.database)
    if has_recent_exact_submission(
        history,
        company=job.company,
        job_title=job.job_title,
        within_days=args.duplicate_days,
    ):
        return _outcome(
            job,
            BatchApplicationStatus.SKIPPED,
            f"confirmed exact company/title submission exists within {args.duplicate_days} days",
        )

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(args.cdp_url)
        if not browser.contexts:
            return _outcome(job, BatchApplicationStatus.FAILED, "Chrome has no browser context")
        context = browser.contexts[0]
        page, is_application_page = _matching_existing_page(context, job, queue)
        if page is not None and _is_pending_company_site_handoff(page, job, queue):
            return _outcome(
                job,
                BatchApplicationStatus.HUMAN_HANDOFF,
                "human intervention required: apply on company site",
            )
        if is_application_page:
            return _retire_if_terminal(
                page,
                _run_application(
                    page,
                    job,
                    args,
                    queue,
                    history,
                    description="",
                ),
            )
        if page is None:
            if not _tab_budget_available(context, args):
                return _outcome(
                    job,
                    BatchApplicationStatus.FAILED,
                    _tab_budget_detail(context, args),
                )
            page = context.new_page()
            page.goto(job.listing_url, wait_until="domcontentloaded", timeout=30_000)
        access = _check_access(
            page,
            job,
            queue,
            goal_id=str(getattr(args, "goal_id", "") or ""),
        )
        if access.blocked:
            return _outcome(
                job,
                BatchApplicationStatus.VERIFICATION_PENDING,
                f"access gate remains pending: {access.reason}",
            )

        body_text, description = _wait_for_listing_evidence(page, job)
        normalized_body = " ".join(body_text.casefold().split())
        if (
            " ".join(job.job_title.casefold().split()) not in normalized_body
            or " ".join(job.company.casefold().split()) not in normalized_body
        ):
            return _outcome(
                job,
                BatchApplicationStatus.HUMAN_HANDOFF,
                "rendered listing does not prove the exact manifest company/title",
            )
        allowed, reason = description_is_allowed(
            _qualification_evidence(job, description),
            required_any_groups=job.required_any_groups,
            blocked_terms=job.blocked_terms,
        )
        if not allowed:
            return _retire_if_terminal(
                page,
                _outcome(job, BatchApplicationStatus.SKIPPED, reason),
            )

        salary = parse_salary_signal(_rendered_salary_signal(page) or job.salary_signal)
        job = job.model_copy(
            update={
                "salary_signal": salary.raw,
                "salary_monthly_min_php": salary.monthly_min_php,
                "salary_monthly_max_php": salary.monthly_max_php,
                "salary_band": salary.band,
            }
        )
        _observe_job_evidence(args, job)
        human_review_approved = _human_review_approved(args, job)
        if not job.employment_type and not human_review_approved:
            return _outcome(
                job,
                BatchApplicationStatus.HUMAN_HANDOFF,
                "employment-type review required: listing does not prove full-time, contract, or internship",
            )
        if job.salary_band == SalaryBand.UNKNOWN and not human_review_approved:
            return _outcome(
                job,
                BatchApplicationStatus.HUMAN_HANDOFF,
                f"salary review required: {salary.reason}",
            )

        if not _tab_budget_available(context, args):
            return _outcome(
                job,
                BatchApplicationStatus.FAILED,
                _tab_budget_detail(context, args),
            )
        application_page, apply_error = _open_apply_destination(page, context)
        if apply_error:
            if apply_error.startswith("apply on company site:"):
                return _retire_if_terminal(
                    application_page,
                    _queue_company_site_handoff(
                        application_page,
                        job,
                        queue,
                        goal_id=str(getattr(args, "goal_id", "") or ""),
                    ),
                )
            status = (
                BatchApplicationStatus.SKIPPED
                if apply_error == "no verified visible Indeed Apply control"
                else BatchApplicationStatus.HUMAN_HANDOFF
            )
            return _retire_if_terminal(
                application_page,
                _outcome(job, status, apply_error),
            )
        return _retire_if_terminal(
            application_page,
            _run_application(
                application_page,
                job,
                args,
                queue,
                history,
                description=description,
            ),
        )


def _run_payload(
    *,
    status: str,
    started_at: str,
    jobs: list[IndeedUnattendedJob],
    latest: dict[str, BatchApplicationOutcome],
    target_submissions: int,
    candidates_started: set[str],
    finished_at: str = "",
    resource_limits: BrowserResourceLimits | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "status": status,
        "started_at": started_at,
        "target_submissions": target_submissions,
        "confirmed_submissions": sum(
            outcome.status == BatchApplicationStatus.SUBMITTED for outcome in latest.values()
        ),
        "candidates_started": len(candidates_started),
        "jobs": [job.model_dump(mode="json") for job in jobs],
        "outcomes": [
            latest[job.task_id].model_dump(mode="json") for job in jobs if job.task_id in latest
        ],
    }
    if resource_limits is not None:
        payload["resource_limits"] = resource_limits.model_dump(mode="json")
    if finished_at:
        payload["finished_at"] = finished_at
    return payload


def run(args: argparse.Namespace, *, worker=_worker) -> int:
    manifest = IndeedUnattendedManifest.model_validate_json(
        args.manifest.read_text(encoding="utf-8")
    )
    jobs = manifest.jobs[: args.max_candidates]
    started_at = datetime.now(timezone.utc).isoformat()
    outcomes: dict[str, BatchApplicationOutcome] = {}
    latest: dict[str, BatchApplicationOutcome] = {}
    candidates_started: set[str] = set()
    goal_store = None
    goal = None
    if str(getattr(args, "goal_id", "") or "").strip():
        goal_store = ApplicationGoalStore(Path(args.database))
        goal = goal_store.get(args.goal_id)
        args.target_submissions = goal.available
    confirmed = 0
    deadline = time.monotonic() + args.verification_wait_minutes * 60
    scheduled: list[tuple[float, int, IndeedUnattendedJob]] = []
    sequence = 0
    for job in jobs:
        heapq.heappush(scheduled, (time.monotonic(), sequence, job))
        sequence += 1
    _write_json(
        args.output / "run.json",
        _run_payload(
            status="running",
            started_at=started_at,
            jobs=jobs,
            latest=latest,
            target_submissions=args.target_submissions,
            candidates_started=candidates_started,
            resource_limits=getattr(args, "resource_limits", None),
        ),
    )
    with ThreadPoolExecutor(max_workers=args.max_parallel) as executor:
        active = {}
        while scheduled or active:
            now = time.monotonic()
            process_all = getattr(args, "process_all_candidates", False)
            safe_parallel = (
                args.max_parallel
                if process_all
                else min(args.max_parallel, args.target_submissions - confirmed)
            )
            while (
                scheduled
                and scheduled[0][0] <= now
                and len(active) < safe_parallel
                and (process_all or confirmed < args.target_submissions)
            ):
                _, _, job = heapq.heappop(scheduled)
                candidates_started.add(job.task_id)
                active[executor.submit(worker, job, args)] = job
            if not active:
                if not process_all and confirmed >= args.target_submissions:
                    scheduled.clear()
                    break
                if scheduled:
                    time.sleep(min(0.25, max(0.0, scheduled[0][0] - time.monotonic())))
                continue
            completed, _ = wait(tuple(active), timeout=0.25, return_when=FIRST_COMPLETED)
            for future in completed:
                job = active.pop(future)
                try:
                    outcome = future.result()
                except Exception as exc:
                    outcome = _outcome(
                        job,
                        BatchApplicationStatus.FAILED,
                        f"worker failed closed: {type(exc).__name__}",
                    )
                latest[job.task_id] = outcome
                _record_goal_outcome(args, outcome, job)
                if (
                    outcome.status == BatchApplicationStatus.SUBMITTED
                    and job.task_id not in outcomes
                ):
                    confirmed += 1
                _write_json(
                    args.output / f"{job.task_id}.json",
                    outcome.model_dump(mode="json"),
                )
                if (
                    _should_delay_for_human(outcome)
                    and not getattr(args, "checkpoint_human", False)
                    and time.monotonic() < deadline
                ):
                    # Human gates are delayed tasks, never worker-blocking busy loops.
                    retry_seconds = getattr(args, "verification_retry_seconds", 5.0)
                    heapq.heappush(
                        scheduled,
                        (time.monotonic() + retry_seconds, sequence, job),
                    )
                    sequence += 1
                else:
                    outcomes[job.task_id] = outcome
            _write_json(
                args.output / "run.json",
                _run_payload(
                    status="running",
                    started_at=started_at,
                    jobs=jobs,
                    latest=latest,
                    target_submissions=args.target_submissions,
                    candidates_started=candidates_started,
                    resource_limits=getattr(args, "resource_limits", None),
                ),
            )
            if not process_all and confirmed >= args.target_submissions:
                scheduled.clear()
            if time.monotonic() >= deadline:
                for _, _, job in scheduled:
                    if job.task_id in candidates_started:
                        outcomes[job.task_id] = latest.get(
                            job.task_id,
                            _outcome(
                                job,
                                BatchApplicationStatus.VERIFICATION_PENDING,
                                "human-verification wait window expired",
                            ),
                        )
                scheduled.clear()
    if goal_store is not None:
        goal = goal_store.get(args.goal_id)
        if goal.status == ApplicationGoalStatus.TARGET_REACHED:
            terminal_status = "target_reached"
        elif any(
            item.status
            in {
                BatchApplicationStatus.HUMAN_HANDOFF,
                BatchApplicationStatus.VERIFICATION_PENDING,
            }
            for item in latest.values()
        ):
            terminal_status = "waiting_for_human"
            goal_store.set_status(args.goal_id, ApplicationGoalStatus.WAITING_FOR_HUMAN)
        else:
            terminal_status = "cycle_complete"
    elif getattr(args, "process_all_candidates", False):
        terminal_status = "all_candidates_processed"
    else:
        terminal_status = (
            "target_reached" if confirmed >= args.target_submissions else "bounded_without_target"
        )
    _write_json(
        args.output / "run.json",
        _run_payload(
            status=terminal_status,
            started_at=started_at,
            finished_at=datetime.now(timezone.utc).isoformat(),
            jobs=jobs,
            latest=latest,
            target_submissions=args.target_submissions,
            candidates_started=candidates_started,
            resource_limits=getattr(args, "resource_limits", None),
        ),
    )
    if getattr(args, "process_all_candidates", False):
        return (
            1
            if any(item.status == BatchApplicationStatus.FAILED for item in outcomes.values())
            else 0
        )
    if confirmed >= args.target_submissions:
        return 0
    return (
        1 if any(item.status == BatchApplicationStatus.FAILED for item in outcomes.values()) else 2
    )


def _unique_run_directory(base: Path) -> Path:
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    candidate = base / run_id
    suffix = 1
    while candidate.exists():
        candidate = base / f"{run_id}-{suffix}"
        suffix += 1
    candidate.mkdir(parents=True)
    return candidate


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    parser.add_argument(
        "--database",
        type=Path,
        default=ROOT / "var" / "state" / "job-applications" / "submissions.sqlite3",
    )
    parser.add_argument(
        "--profile-database",
        type=Path,
        help="SQLite verified identity and resume routes; defaults to --database.",
    )
    parser.add_argument(
        "--queue",
        type=Path,
        default=ROOT / "var" / "state" / "job-applications" / "verification-queue.json",
    )
    parser.add_argument("--output", type=Path, default=ROOT / "out" / "indeed-unattended")
    parser.add_argument("--target-submissions", type=int, default=3)
    parser.add_argument(
        "--goal-id",
        default="",
        help="Durable application-goal ID whose confirmation quota this run contributes to.",
    )
    parser.add_argument("--max-parallel", type=int, default=3)
    parser.add_argument("--max-candidates", type=int, default=12)
    parser.add_argument(
        "--resource-mode",
        choices=("auto", "manual"),
        default="auto",
        help=(
            "Auto clamps workers, tabs, and candidates from live RAM/CPU/swap pressure; "
            "manual honors the explicit numeric limits."
        ),
    )
    parser.add_argument(
        "--max-tabs",
        type=int,
        default=0,
        help="Maximum browser tabs for this batch; 0 lets auto mode calculate it.",
    )
    parser.add_argument(
        "--process-all-candidates",
        action="store_true",
        help="Process every bounded manifest candidate instead of stopping at the target count.",
    )
    parser.add_argument("--verification-wait-minutes", type=int, default=180)
    parser.add_argument(
        "--checkpoint-human",
        action="store_true",
        help="Checkpoint human gates and exit instead of keeping idle workers alive.",
    )
    parser.add_argument("--duplicate-days", type=int, default=30)
    parser.add_argument(
        "--autonomous-submit",
        action="store_true",
        help="Explicitly permit validated final Submit on smartapply.indeed.com for this batch.",
    )
    parser.add_argument(
        "--safe-draft-only",
        action="store_true",
        help=(
            "Allow read-only and nonsensitive draft-safe work, but stop before sensitive "
            "writes, resume upload/Continue, Review, and Submit."
        ),
    )
    parser.add_argument(
        "--assisted-apply",
        action="store_true",
        help=(
            "Use verified profile/question-bank writes while retaining separate resume upload, "
            "resume Continue, and final Submit gates."
        ),
    )
    parser.add_argument(
        "--verified-phone",
        default="",
        help=(
            "Explicit runtime-verified phone. When omitted, the runner may preserve a non-empty "
            "Indeed contact value only when its visible country control matches --phone-country-iso."
        ),
    )
    parser.add_argument(
        "--use-saved-contact-phone",
        action="store_true",
        help=(
            "Treat a non-empty visible Indeed contact number as the verified runtime number, "
            "then reconcile its separate country control to --phone-country-iso."
        ),
    )
    parser.add_argument(
        "--saved-phone-original-calling-code",
        default="",
        help=(
            "Observed calling-code prefix currently embedded in the saved visible phone value. "
            "It is stripped before reconciling to --phone-country-calling-code."
        ),
    )
    parser.add_argument(
        "--phone-country-calling-code",
        default="",
        help="Runtime override; otherwise load the verified calling code from SQLite.",
    )
    parser.add_argument(
        "--phone-country-iso",
        default="",
        help="Runtime override; otherwise load the verified country ISO from SQLite.",
    )
    parser.add_argument(
        "--approved-answers",
        type=Path,
        help="JSON fallback profile used only with --questionnaire-store=json.",
    )
    parser.add_argument(
        "--questionnaire-store",
        choices=("auto", "mongodb", "json"),
        default="auto",
        help="Prefer MongoDB and fall back to the reviewed local JSON in auto mode.",
    )
    parser.add_argument(
        "--questionnaire-json-fallback",
        type=Path,
        default=Path(
            os.environ.get(
                "QUESTIONNAIRE_APPROVED_JSON",
                ROOT / "var" / "state" / "job-applications" / "binance-bap-approved-answers.json",
            )
        ),
        help="Reviewed exact-answer JSON used when the optional MongoDB store is unavailable.",
    )
    parser.add_argument("--mongodb-uri", default=DEFAULT_MONGODB_URI)
    parser.add_argument("--mongodb-database", default=DEFAULT_MONGODB_DATABASE)
    parser.add_argument(
        "--question-ai-provider",
        choices=("google", "off"),
        default="google",
        help=(
            "Use strict structured Google AI only for novel evidence-grounded questions; "
            "saved MongoDB and deterministic answers always take priority."
        ),
    )
    parser.add_argument(
        "--question-ai-model",
        default="gemini-3.1-pro-preview",
        help="Google model for novel questions; API key is read only from process environment.",
    )
    return parser


def main() -> int:
    args = _parser().parse_args()
    if args.safe_draft_only and args.autonomous_submit:
        raise SystemExit("--safe-draft-only cannot be combined with --autonomous-submit")
    if args.assisted_apply and args.autonomous_submit:
        raise SystemExit("--assisted-apply cannot be combined with --autonomous-submit")
    if args.assisted_apply and args.safe_draft_only:
        raise SystemExit("--assisted-apply cannot be combined with --safe-draft-only")
    if not 1 <= args.target_submissions <= 24:
        raise SystemExit("--target-submissions must be between 1 and 24")
    if not 1 <= args.max_parallel <= 5:
        raise SystemExit("--max-parallel must be between 1 and 5")
    if not 1 <= args.max_candidates <= 24:
        raise SystemExit("--max-candidates must be between 1 and 24")
    if not 0 <= args.max_tabs <= 24:
        raise SystemExit("--max-tabs must be between 0 and 24")
    if not 1 <= args.verification_wait_minutes <= 720:
        raise SystemExit("--verification-wait-minutes must be between 1 and 720")
    snapshot = read_browser_resource_snapshot()
    requested_tabs = args.max_tabs
    if args.resource_mode == "auto":
        args.resource_limits = calculate_browser_resource_limits(
            snapshot,
            requested_workers=args.max_parallel,
            requested_candidates=args.max_candidates,
            requested_tabs=requested_tabs,
        )
        args.max_parallel = args.resource_limits.max_workers
        args.max_candidates = args.resource_limits.max_candidates
        args.max_tabs = args.resource_limits.max_tabs
    else:
        args.max_tabs = requested_tabs or min(12, args.max_candidates)
        args.resource_limits = BrowserResourceLimits(
            max_workers=args.max_parallel,
            max_tabs=args.max_tabs,
            max_candidates=args.max_candidates,
            reason="manual resource limits",
            snapshot=snapshot,
        )
    try:
        args.baseline_tabs = _browser_page_count(args.cdp_url)
    except (requests.RequestException, ValueError):
        raise SystemExit("could not inventory the approved Chrome/CDP page baseline") from None
    args.output = _unique_run_directory(args.output)
    print(f"Indeed unattended run directory: {args.output}", flush=True)
    print(
        "Resource limits: "
        f"workers={args.max_parallel} worker_tabs={args.max_tabs} "
        f"baseline_tabs={args.baseline_tabs} "
        f"candidates={args.max_candidates} ({args.resource_limits.reason})",
        flush=True,
    )
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
