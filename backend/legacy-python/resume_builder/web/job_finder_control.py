"""Read-only control state and explicit human handoffs for the local job finder UI."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from threading import RLock
from typing import Any
from urllib.parse import quote, urlsplit

import requests

from ..job_application import (
    ApplicationProfileStore,
    ApplicationSubmissionHistory,
    ConfirmationSource,
    DevelopmentQuestionBridge,
    HumanVerificationQueue,
    InterventionAction,
    VerificationQueueEntry,
    check_access_gate,
)
from ..job_application.dynamic_layout_runtime import dynamic_planner_status
from .auth import IdentityStore, auth_status, clear_social_session, provider_configuration_status
from .job_finder_supervisor import DEFAULT_ARTIFACT_DIR, DEFAULT_DATABASE
from .shared_browser import cdp_url, open_tab

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_QUEUE_PATH = REPO_ROOT / "var" / "state" / "job-applications" / "verification-queue.json"
DEFAULT_RUN_ROOT = REPO_ROOT / "out" / "indeed-unattended"
DEFAULT_DEVELOPMENT_BRIDGE_ROOT = REPO_ROOT / "out" / "development-question-bridge"
DEFAULT_GOAL_ROOT = REPO_ROOT / "out" / "goals"

_PROVIDERS = {"github", "google", "microsoft", "facebook", "linkedin", "indeed"}
_SOCIAL_PROVIDERS = {"facebook", "linkedin"}
_WEBSITE_LOGOUT_URLS = {
    "github": "https://github.com/logout",
    "google": "https://accounts.google.com/Logout",
    "microsoft": "https://login.microsoftonline.com/common/oauth2/v2.0/logout",
    "facebook": "https://www.facebook.com/settings?tab=security",
    "linkedin": "https://www.linkedin.com/m/logout/",
    "indeed": "https://secure.indeed.com/account/logout",
}
_SIGN_IN_URLS = {"indeed": "https://secure.indeed.com/auth"}
_PREVIEW_LOCK = RLock()
_PREVIEW_CACHE: dict[str, tuple[float, bytes]] = {}
_QUESTION_BANK_CACHE: tuple[float, dict[str, Any]] | None = None
_CURRENT_GOAL_STATUSES = {"active", "waiting_for_human", "waiting_for_candidates"}


def _cdp_url() -> str:
    return cdp_url()


def _queue() -> HumanVerificationQueue:
    configured = os.environ.get("JOB_FINDER_VERIFICATION_QUEUE", "").strip()
    return HumanVerificationQueue(Path(configured) if configured else DEFAULT_QUEUE_PATH)


def _targets() -> list[dict[str, Any]]:
    try:
        response = requests.get(f"{_cdp_url()}/json", timeout=2)
        response.raise_for_status()
        value = response.json()
    except (requests.RequestException, ValueError):
        return []
    return [item for item in value if isinstance(item, dict) and item.get("type") == "page"]


def _latest_run() -> dict[str, Any]:
    candidates = list(DEFAULT_RUN_ROOT.glob("**/run.json")) if DEFAULT_RUN_ROOT.exists() else []
    if not candidates:
        return {}
    path = max(candidates, key=lambda candidate: candidate.stat().st_mtime)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"status": "unavailable", "error": "latest run artifact is unreadable"}
    if not isinstance(value, dict):
        return {"status": "unavailable", "error": "latest run artifact is invalid"}
    try:
        value["artifact"] = str(path.relative_to(REPO_ROOT))
    except ValueError:
        value["artifact"] = path.name
    return value


def _resume_catalog() -> list[dict[str, Any]]:
    """Inventory generated PDFs and their deterministic job-search routes."""
    routes = {
        route.filename: route for route in ApplicationProfileStore(DEFAULT_DATABASE).resume_routes()
    }
    filenames = set(routes)
    if DEFAULT_ARTIFACT_DIR.is_dir():
        filenames.update(path.name for path in DEFAULT_ARTIFACT_DIR.glob("*.pdf"))
    items: list[dict[str, Any]] = []
    for filename in sorted(filenames):
        pdf_path = DEFAULT_ARTIFACT_DIR / filename
        metadata_path = pdf_path.with_suffix(".resume.json")
        label = pdf_path.stem.replace("-", " ").title()
        role_id = ""
        if metadata_path.is_file():
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                role = metadata.get("role", {}) if isinstance(metadata, dict) else {}
                if isinstance(role, dict):
                    label = str(role.get("label") or label)[:160]
                    role_id = str(role.get("id") or "")[:120]
            except (OSError, json.JSONDecodeError):
                pass
        route = routes.get(filename)
        items.append(
            {
                "filename": filename,
                "label": label,
                "role_id": role_id,
                "terms": list(route.terms) if route else [],
                "is_default": bool(route and route.is_default),
                "artifact_ready": pdf_path.is_file() and metadata_path.is_file(),
                "routing_ready": route is not None,
            }
        )
    return items


def _question_bank_state() -> dict[str, Any]:
    """Report local answer-source readiness without exposing stored values."""
    global _QUESTION_BANK_CACHE
    if _QUESTION_BANK_CACHE is not None and time.monotonic() - _QUESTION_BANK_CACHE[0] < 15:
        return dict(_QUESTION_BANK_CACHE[1])
    fallback = Path(
        os.environ.get(
            "QUESTIONNAIRE_APPROVED_JSON",
            REPO_ROOT / "var" / "state" / "job-applications" / "binance-bap-approved-answers.json",
        )
    )
    json_pages = 0
    if fallback.is_file():
        try:
            payload = json.loads(fallback.read_text(encoding="utf-8"))
            pages = payload.get("pages", []) if isinstance(payload, dict) else []
            json_pages = len(pages) if isinstance(pages, list) else 0
        except (OSError, json.JSONDecodeError):
            pass
    mongo_pages = 0
    mongo_ready = False
    try:
        from pymongo import MongoClient

        client = MongoClient(
            os.environ.get(
                "MONGODB_URI",
                "mongodb://127.0.0.1:27017/?directConnection=true",
            ),
            serverSelectionTimeoutMS=300,
        )
        try:
            mongo_ready = bool(client["admin"].command("ping").get("ok"))
            if mongo_ready:
                database = client[os.environ.get("MONGODB_DATABASE", "pytorch_ph")]
                mongo_pages = int(
                    database["indeed_question_sets"].count_documents(
                        {"domain": "smartapply.indeed.com", "schema_version": 1}
                    )
                )
        finally:
            client.close()
    except Exception:  # noqa: BLE001 - status degrades to the reviewed JSON source
        mongo_ready = False
    if mongo_ready and mongo_pages:
        state = {"source": "MongoDB", "pages": mongo_pages, "status": "ready"}
    elif json_pages:
        status = "MongoDB empty; JSON fallback ready" if mongo_ready else "MongoDB offline; JSON fallback ready"
        state = {"source": "approved JSON", "pages": json_pages, "status": status}
    else:
        state = {"source": "", "pages": 0, "status": "no approved question sets"}
    _QUESTION_BANK_CACHE = (time.monotonic(), state)
    return dict(state)


def _resume_lookup() -> tuple[dict[str, str], dict[str, str]]:
    """Recover resume labels for current and historical queue microtasks."""
    by_task: dict[str, str] = {}
    by_reference: dict[str, str] = {}
    candidates = sorted(
        DEFAULT_RUN_ROOT.glob("**/run.json") if DEFAULT_RUN_ROOT.exists() else (),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for path in candidates:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for job in payload.get("jobs", []) if isinstance(payload, dict) else []:
            if not isinstance(job, dict):
                continue
            resume_file = str(job.get("resume_file", "")).strip()
            if not resume_file:
                continue
            task_id = str(job.get("task_id", "")).strip()
            reference = (
                f"{str(job.get('company', '')).strip()} — {str(job.get('job_title', '')).strip()}"
            ).strip(" —")
            if task_id:
                by_task.setdefault(task_id, resume_file)
            if reference:
                by_reference.setdefault(reference, resume_file)
    return by_task, by_reference


def _site_for_domain(domain: str) -> str:
    normalized = domain.casefold()
    if "linkedin" in normalized:
        return "linkedin"
    if "indeed" in normalized:
        return "indeed"
    if "facebook" in normalized:
        return "facebook"
    return normalized or "other"


def _page_role(url: str, entry: VerificationQueueEntry | None = None) -> str:
    """Classify only supported search and mapped application browser pages."""
    parts = urlsplit(url)
    host = (parts.hostname or "").casefold()
    path = parts.path.rstrip("/") or "/"
    indeed_host = host == "indeed.com" or host.endswith(".indeed.com")
    if indeed_host and path == "/jobs":
        return "search"
    if host == "smartapply.indeed.com" or (indeed_host and path == "/viewjob"):
        return "application"
    if entry is not None and entry.action == InterventionAction.EXTERNAL_APPLICATION:
        return "application"
    return ""


def _instruction(action: InterventionAction) -> str:
    return {
        InterventionAction.CAPTCHA: "Complete the CAPTCHA in the open browser tab.",
        InterventionAction.HUMAN_VERIFICATION: "Complete the visible human verification check.",
        InterventionAction.UNKNOWN_QUESTION: (
            "Answer the listed fields in the browser, then return here and use "
            "Save answers & continue."
        ),
        InterventionAction.SIGN_IN: "Sign in in the visible browser and complete any 2FA prompt.",
        InterventionAction.RESUME_UPLOAD: "Review the selected resume, then approve this upload.",
        InterventionAction.RESUME_CONTINUE: (
            "Review the uploaded resume preview, then approve Continue."
        ),
        InterventionAction.LAYOUT_REVIEW: (
            "Review the captured application layout, then retry when the page is ready."
        ),
        InterventionAction.EXTERNAL_APPLICATION: "Complete this company-site application manually.",
        InterventionAction.OTHER: "Review the browser page and complete the requested action.",
    }[action]


def _entry_payload(
    entry: VerificationQueueEntry,
    *,
    live_target_ids: set[str] | None = None,
) -> dict[str, Any]:
    target_is_live = bool(entry.browser_target_id) and (
        live_target_ids is None or entry.browser_target_id in live_target_ids
    )
    return {
        **entry.model_dump(mode="json"),
        "site": _site_for_domain(entry.domain),
        "instruction": _instruction(entry.action),
        "can_focus": target_is_live,
        "preview_url": (
            f"/api/job-finder/targets/{entry.browser_target_id}/preview" if target_is_live else ""
        ),
    }


def _current_queue_entries(
    entries: list[VerificationQueueEntry],
    *,
    live_target_ids: set[str],
    goal: dict[str, Any],
    goal_items: list[dict[str, Any]],
) -> list[VerificationQueueEntry]:
    """Keep only handoffs tied to the active plan or an actually open browser page."""
    active_goal_id = (
        str(goal.get("id", "")) if str(goal.get("status", "")) in _CURRENT_GOAL_STATUSES else ""
    )
    active_task_ids = {str(item.get("task_id", "")) for item in goal_items if item.get("task_id")}
    active_references = {
        f"{str(item.get('company', '')).strip()} — {str(item.get('job_title', '')).strip()}"
        for item in goal_items
        if item.get("company") or item.get("job_title")
    }
    current: list[VerificationQueueEntry] = []
    for entry in entries:
        target_is_live = (
            bool(entry.browser_target_id) and entry.browser_target_id in live_target_ids
        )
        belongs_to_goal = bool(active_goal_id) and entry.goal_id == active_goal_id
        identifier_goal_match = (
            bool(active_goal_id)
            and (
                (bool(entry.task_id) and entry.task_id in active_task_ids)
                or entry.application_reference in active_references
            )
        )
        if target_is_live or belongs_to_goal or identifier_goal_match:
            current.append(entry)
    return current


def _intervention_key(item: dict[str, Any]) -> str:
    company = " ".join(str(item.get("company", "")).casefold().split())
    title = " ".join(str(item.get("job_title", "")).casefold().split())
    if company or title:
        return f"reference:{company}—{title}"
    reference = " ".join(str(item.get("application_reference", "")).casefold().split())
    if reference:
        return f"reference:{reference.replace(' — ', '—')}"
    task_id = str(item.get("task_id", "")).strip()
    if task_id:
        return f"task:{task_id}"
    return f"entry:{str(item.get('id', '')).strip()}"


def _listing_url_for_task(task_id: str) -> str:
    """Recover only an exact Indeed listing URL from goal/run artifacts."""
    latest = _latest_run()
    payloads = [latest] if isinstance(latest, dict) else []
    candidates = []
    if DEFAULT_GOAL_ROOT.exists():
        candidates.extend(DEFAULT_GOAL_ROOT.glob("**/manifest.json"))
    if DEFAULT_RUN_ROOT.exists():
        candidates.extend(DEFAULT_RUN_ROOT.glob("**/run.json"))
    for path in sorted(candidates, key=lambda item: item.stat().st_mtime, reverse=True):
        try:
            payloads.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    for payload in payloads:
        for job in payload.get("jobs", []) if isinstance(payload, dict) else []:
            if not isinstance(job, dict) or str(job.get("task_id", "")) != task_id:
                continue
            candidate = str(job.get("listing_url", ""))
            parts = urlsplit(candidate)
            host = (parts.hostname or "").casefold()
            if (host == "indeed.com" or host.endswith(".indeed.com")) and parts.path == "/viewjob":
                return candidate
    return ""


def _work_item_actions(item: dict[str, Any]) -> list[str]:
    if item.get("source") == "goal":
        if item.get("state") == "reserved":
            return ["confirm", "release"]
        if item.get("can_review_in_control_center"):
            return ["review_approve", "release"]
        actions = ["reopen", "retry", "release"] if item.get("can_reopen") else ["retry", "release"]
        return actions
    action = str(item.get("action", ""))
    actions = ["focus"] if item.get("can_focus") else []
    if not actions and action in {"captcha", "human_verification", "sign_in", "layout_review"}:
        actions.append("reopen")
    if action in {"captcha", "human_verification", "sign_in"}:
        actions.append("recheck")
    elif action == "unknown_question":
        actions.append("approve_question")
    elif action in {"resume_upload", "resume_continue"}:
        actions.append("approve_resume")
    elif action == "external_application":
        actions.append("confirm_external")
    elif action == "layout_review":
        actions.append("retry")
    actions.append("release")
    return list(dict.fromkeys(actions))


def _canonical_work_items(
    pending: list[dict[str, Any]],
    goal: dict[str, Any],
    goal_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return one deduplicated actionable list used by both counts and UI cards."""
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in pending:
        payload = {**entry, "source": "queue", "state": "human_handoff"}
        payload["actions"] = _work_item_actions(payload)
        key = _intervention_key(payload)
        if key not in seen:
            seen.add(key)
            items.append(payload)
    if str(goal.get("status", "")) not in _CURRENT_GOAL_STATUSES:
        return items
    for goal_item in goal_items:
        if goal_item.get("state") not in {"reserved", "human_handoff"}:
            continue
        payload = {
            **goal_item,
            "id": f"goal:{goal_item.get('task_id', '')}",
            "source": "goal",
            "application_reference": (
                f"{goal_item.get('company', '')} — {goal_item.get('job_title', '')}"
            ),
            "action": (
                "submission_review"
                if goal_item.get("state") == "reserved"
                else "layout_review"
                if "unknown" in str(goal_item.get("detail", "")).casefold()
                else "other"
            ),
            "instruction": str(goal_item.get("detail", "human review required")),
            "can_focus": False,
            "can_reopen": bool(_listing_url_for_task(str(goal_item.get("task_id", "")))),
        }
        key = _intervention_key(payload)
        if key in seen:
            continue
        payload["actions"] = _work_item_actions(payload)
        seen.add(key)
        items.append(payload)
    return items


def _current_intervention_count(
    interventions: list[dict[str, Any]],
    goal: dict[str, Any],
    goal_items: list[dict[str, Any]],
) -> int:
    if str(goal.get("status", "")) in _CURRENT_GOAL_STATUSES:
        actionable_goal_items = [
            item for item in goal_items if item.get("state") in {"reserved", "human_handoff"}
        ]
    else:
        actionable_goal_items = []
    return len({_intervention_key(item) for item in [*interventions, *actionable_goal_items]})


def _automatic_work(run: dict[str, Any]) -> list[dict[str, Any]]:
    jobs = {
        str(item.get("task_id", "")): item
        for item in run.get("jobs", [])
        if isinstance(item, dict) and item.get("task_id")
    }
    outcomes = {
        str(item.get("task", {}).get("task_id", "")): item
        for item in run.get("outcomes", [])
        if isinstance(item, dict) and isinstance(item.get("task"), dict)
    }
    items: list[dict[str, Any]] = []
    for task_id, job in jobs.items():
        outcome = outcomes.get(task_id, {})
        status = str(outcome.get("status") or "queued")
        if status in {"verification_pending", "human_handoff"}:
            continue
        items.append(
            {
                "task_id": task_id,
                "company": str(job.get("company", ""))[:160],
                "job_title": str(job.get("job_title", ""))[:200],
                "site": _site_for_domain(str(job.get("domain", "indeed"))),
                "status": status,
                "resume_file": str(job.get("resume_file", ""))[:160],
                "detail": str(outcome.get("detail", "Waiting for an available worker."))[:300],
            }
        )
    return items


def _live_pages(
    pending: list[VerificationQueueEntry],
    targets: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    by_target = {entry.browser_target_id: entry for entry in pending if entry.browser_target_id}
    pages: list[dict[str, Any]] = []
    for target in targets if targets is not None else _targets():
        target_id = str(target.get("id", ""))
        url = str(target.get("url", ""))
        parts = urlsplit(url)
        entry = by_target.get(target_id)
        page_role = _page_role(url, entry)
        if not page_role:
            continue
        site = _site_for_domain(parts.hostname or "")
        pages.append(
            {
                "target_id": target_id,
                "site": site,
                "title": str(target.get("title", "Indeed"))[:200],
                "safe_path": parts.path or "/",
                "page_role": page_role,
                "group": "human_intervention" if entry else "automatic",
                "action": entry.action.value if entry else "working",
                "status": entry.status.value if entry else "browser_open",
                "application_reference": entry.application_reference if entry else "",
                "question_labels": entry.question_labels if entry else [],
                "preview_url": (
                    f"/api/job-finder/targets/{target_id}/preview" if site == "indeed" else ""
                ),
                "can_focus": True,
            }
        )
    return pages


def _goal_state() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    from .job_finder_supervisor import goal_store, process_status

    store = goal_store()
    goal = store.active() or store.latest()
    if goal is None:
        return {}, []
    items = store.items(goal.id)
    inventory_candidates = list((DEFAULT_GOAL_ROOT / goal.id).glob("cycle-*/inventory.json"))
    search_inventory: dict[str, Any] = {}
    if inventory_candidates:
        inventory_path = max(inventory_candidates, key=lambda path: path.stat().st_mtime)
        try:
            loaded_inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
            if isinstance(loaded_inventory, dict):
                search_inventory = {
                    key: value for key, value in loaded_inventory.items() if key != "items"
                }
        except (OSError, json.JSONDecodeError):
            search_inventory = {
                "status": "error",
                "warning": "Latest candidate inventory is unreadable.",
            }
    site_counts: dict[str, dict[str, int]] = {}
    salary_counts: dict[str, dict[str, int]] = {
        band.value: {"discovered": 0, "reserved": 0, "confirmed": 0} for band in goal.salary_targets
    }
    salary_counts["unknown"] = {"discovered": 0, "reserved": 0, "confirmed": 0}
    level_counts = {"junior": 0, "intern": 0, "unknown": 0}
    for item in items:
        counts = site_counts.setdefault(
            item.site,
            {"total": 0, "confirmed": 0, "reserved": 0, "human": 0, "skipped": 0},
        )
        counts["total"] += 1
        if item.state.value == "confirmed":
            counts["confirmed"] += 1
        elif item.state.value == "reserved":
            counts["reserved"] += 1
        elif item.state.value == "human_handoff":
            counts["human"] += 1
        elif item.state.value in {"skipped", "failed", "released"}:
            counts["skipped"] += 1
        band = item.salary_band.value
        if band == "legacy_unclassified":
            band = "unknown"
        salary = salary_counts.setdefault(band, {"discovered": 0, "reserved": 0, "confirmed": 0})
        salary["discovered"] += 1
        if item.state.value == "reserved":
            salary["reserved"] += 1
        elif item.state.value == "confirmed":
            salary["confirmed"] += 1
        level_counts[item.job_level.value] = level_counts.get(item.job_level.value, 0) + 1
    salary_analytics = []
    labels = {
        "below_20k": "Below ₱20k",
        "php_20k_40k": "₱20k–₱40k",
        "php_40k_80k": "₱40k–₱80k",
        "php_80k_plus": "₱80k+",
        "unknown": "Unknown salary",
    }
    for band in (*goal.salary_targets, "unknown"):
        key = band.value if hasattr(band, "value") else str(band)
        values = salary_counts.get(key, {})
        target = int(goal.salary_targets.get(band, 0)) if key != "unknown" else 0
        salary_analytics.append(
            {
                "band": key,
                "label": labels[key],
                "target": target,
                "mix_percent": int(goal.salary_target_mix.get(band, 0)) if key != "unknown" else 0,
                "discovered": int(values.get("discovered", 0)),
                "reserved": int(values.get("reserved", 0)),
                "confirmed": int(values.get("confirmed", 0)),
                "remaining": max(
                    0, target - int(values.get("confirmed", 0)) - int(values.get("reserved", 0))
                ),
            }
        )
    return (
        {
            **goal.model_dump(mode="json"),
            "remaining": goal.remaining,
            "available": goal.available,
            "process": process_status(goal.id),
            "site_counts": site_counts,
            "salary_analytics": salary_analytics,
            "job_level_counts": level_counts,
            "search_inventory": search_inventory,
        },
        [
            {
                **item.model_dump(mode="json"),
                "can_review_in_control_center": item.state.value == "human_handoff"
                and (
                    item.detail.casefold().startswith("salary review required:")
                    or item.detail.casefold().startswith("employment-type review required:")
                ),
            }
            for item in items
        ],
    )


def _run_interventions(
    run: dict[str, Any],
    queued: list[dict[str, Any]],
    suppressed_references: set[str] | None = None,
) -> list[dict[str, Any]]:
    jobs = {
        str(item.get("task_id", "")): item
        for item in run.get("jobs", [])
        if isinstance(item, dict) and item.get("task_id")
    }
    queued_references = {str(item.get("application_reference", "")) for item in queued}
    suppressed = suppressed_references or set()
    items: list[dict[str, Any]] = []
    for outcome in run.get("outcomes", []):
        if not isinstance(outcome, dict) or outcome.get("status") not in {
            "verification_pending",
            "human_handoff",
        }:
            continue
        task = outcome.get("task") if isinstance(outcome.get("task"), dict) else {}
        job = jobs.get(str(task.get("task_id", "")), {})
        reference = str(task.get("application_reference", "")).strip() or (
            f"{str(task.get('company', '')).strip()} — {str(task.get('job_title', '')).strip()}"
        ).strip(" —")
        if reference in queued_references or reference in suppressed:
            continue
        detail = str(outcome.get("detail", "human review required"))[:300]
        lowered = detail.casefold()
        if "captcha" in lowered:
            action = InterventionAction.CAPTCHA
        elif "verification" in lowered or "are you human" in lowered:
            action = InterventionAction.HUMAN_VERIFICATION
        elif "questionnaire" in lowered or "question" in lowered:
            action = InterventionAction.UNKNOWN_QUESTION
        elif "sign in" in lowered or "signed out" in lowered:
            action = InterventionAction.SIGN_IN
        elif "company site" in lowered or "external" in lowered:
            action = InterventionAction.EXTERNAL_APPLICATION
        else:
            action = InterventionAction.OTHER
        domain = str(task.get("domain", ""))
        items.append(
            {
                "id": f"run-{str(task.get('task_id', 'unknown'))[:80]}",
                "application_reference": reference or "Application",
                "domain": domain,
                "url": "",
                "reason": detail,
                "status": "pending",
                "created_at": "",
                "updated_at": run.get("finished_at") or run.get("started_at", ""),
                "occurrences": 1,
                "browser_target_id": "",
                "group": "human_intervention",
                "action": action.value,
                "question_labels": [],
                "site": _site_for_domain(domain),
                "instruction": _instruction(action),
                "can_focus": False,
                "resume_file": str(job.get("resume_file", ""))[:160],
            }
        )
    return items


def _session_state(targets: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    state = auth_status()
    state["oauth_setup"] = provider_configuration_status()
    browser_targets = targets if targets is not None else _targets()
    indeed_targets = [
        target
        for target in browser_targets
        if "indeed.com" in (urlsplit(str(target.get("url", ""))).hostname or "").lower()
    ]
    signed_in_target = next(
        (
            target
            for target in indeed_targets
            if "/myjobs" in urlsplit(str(target.get("url", ""))).path.casefold()
            or "my jobs" in str(target.get("title", "")).casefold()
        ),
        None,
    )
    state.setdefault("job_sites", {})["indeed"] = {
        "connected": signed_in_target is not None,
        "browser_open": bool(indeed_targets),
        "status": (
            "signed-in account evidence visible"
            if signed_in_target
            else "Indeed tab open; sign-in unverified"
            if indeed_targets
            else "No Indeed browser tab"
        ),
    }
    return state


def control_state() -> dict[str, Any]:
    run = _latest_run()
    targets = _targets()
    live_target_ids = {str(target.get("id", "")) for target in targets}
    all_pending_entries = _queue().pending()
    goal_payload, goal_items = _goal_state()
    pending_entries = _current_queue_entries(
        all_pending_entries,
        live_target_ids=live_target_ids,
        goal=goal_payload,
        goal_items=goal_items,
    )
    pending = [_entry_payload(entry, live_target_ids=live_target_ids) for entry in pending_entries]
    resume_by_task, resume_by_reference = _resume_lookup()
    for item in pending:
        item["resume_file"] = resume_by_reference.get(
            str(item.get("application_reference", "")),
            str(item.get("resume_file", "")),
        )
    for item in goal_items:
        reference = f"{item.get('company', '')} — {item.get('job_title', '')}"
        item["resume_file"] = resume_by_task.get(
            str(item.get("task_id", "")), resume_by_reference.get(reference, "")
        )
    suppressed_references = {
        f"{item.get('company', '')} — {item.get('job_title', '')}" for item in goal_items
    }
    legacy_interventions = [
        *pending,
        *(
            _run_interventions(run, pending, suppressed_references)
            if run.get("status") == "running"
            else []
        ),
    ]
    work_items = _canonical_work_items(pending, goal_payload, goal_items)
    automatic = _automatic_work(run)
    development_requests = DevelopmentQuestionBridge(DEFAULT_DEVELOPMENT_BRIDGE_ROOT).pending()
    automatic.extend(
        {
            "task_id": f"ai-{request.request_id}",
            "company": request.company,
            "job_title": request.job_title,
            "site": _site_for_domain(request.domain),
            "status": "ai_answering",
            "detail": "Current-session development answer requested: "
            + " · ".join(question.label for question in request.questions),
            "request_id": request.request_id,
        }
        for request in development_requests
    )
    return {
        "sessions": _session_state(targets),
        "run": {
            "status": run.get("status", "not_started"),
            "started_at": run.get("started_at", ""),
            "finished_at": run.get("finished_at", ""),
            "artifact": run.get("artifact", ""),
            "confirmed_submissions": run.get("confirmed_submissions", 0),
            "error": run.get("error", ""),
        },
        "automatic": automatic,
        "interventions": legacy_interventions,
        "work_items": work_items,
        "live_pages": _live_pages(pending_entries, targets),
        "goal": goal_payload,
        "goal_items": goal_items,
        "resume_catalog": _resume_catalog(),
        "question_bank": _question_bank_state(),
        "planner_status": dynamic_planner_status(),
        "search_progress": goal_payload.get("search_inventory", {}),
        "resume_artifact_directory": str(DEFAULT_ARTIFACT_DIR),
        "development_questions": [
            {
                "request_id": request.request_id,
                "site": _site_for_domain(request.domain),
                "company": request.company,
                "job_title": request.job_title,
                "questions": [
                    {
                        "question_id": question.question_id,
                        "label": question.label,
                        "kind": question.kind,
                        "options": question.options,
                        "max_length": question.max_length,
                        "evidence": request.evidence.get(question.question_id, []),
                    }
                    for question in request.questions
                ],
            }
            for request in development_requests
        ],
        "counts": {
            "automatic": len(automatic),
            "interventions": len(work_items),
            "access_interventions": sum(
                item.get("action") in {"captcha", "human_verification", "sign_in"}
                for item in work_items
            ),
            "question_interventions": sum(
                item.get("action") == "unknown_question" for item in work_items
            ),
        },
    }


def focus_target(target_id: str) -> None:
    safe_id = "".join(
        character for character in target_id if character.isalnum() or character in "-_"
    )
    if not safe_id or safe_id != target_id:
        raise ValueError("invalid browser target")
    response = requests.post(f"{_cdp_url()}/json/activate/{quote(safe_id)}", timeout=3)
    response.raise_for_status()


def capture_target_preview(target_id: str) -> bytes:
    safe_id = "".join(
        character for character in target_id if character.isalnum() or character in "-_"
    )
    targets = {str(target.get("id", "")): target for target in _targets()}
    target = targets.get(safe_id)
    if not safe_id or target is None:
        raise KeyError(target_id)
    if _site_for_domain(urlsplit(str(target.get("url", ""))).hostname or "") != "indeed":
        raise ValueError("preview is limited to registered job-site targets")

    with _PREVIEW_LOCK:
        cached = _PREVIEW_CACHE.get(safe_id)
        if cached is not None and time.monotonic() - cached[0] < 12:
            return cached[1]

        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(_cdp_url(), timeout=5_000)
            for context in browser.contexts:
                for page in context.pages:
                    session = context.new_cdp_session(page)
                    try:
                        info = session.send("Target.getTargetInfo")
                        if str(info.get("targetInfo", {}).get("targetId", "")) == safe_id:
                            image = page.screenshot(type="jpeg", quality=45, animations="disabled")
                            _PREVIEW_CACHE[safe_id] = (time.monotonic(), image)
                            return image
                    finally:
                        session.detach()
    raise KeyError(target_id)


def focus_intervention(entry_id: str) -> None:
    entry = next((item for item in _queue().pending() if item.id == entry_id), None)
    if entry is None:
        raise KeyError(entry_id)
    if not entry.browser_target_id:
        raise ValueError("intervention has no live browser target")
    focus_target(entry.browser_target_id)


def reopen_intervention(entry_id: str) -> dict[str, str]:
    """Reopen one stale access handoff in Brave and attach its new CDP target."""
    queue = _queue()
    entry = next((item for item in queue.pending() if item.id == entry_id), None)
    if entry is None:
        raise KeyError(entry_id)
    if entry.action not in {
        InterventionAction.CAPTCHA,
        InterventionAction.HUMAN_VERIFICATION,
        InterventionAction.SIGN_IN,
        InterventionAction.LAYOUT_REVIEW,
    }:
        raise ValueError("this handoff cannot be reopened automatically")
    recovery_url = _listing_url_for_task(entry.task_id)
    if not recovery_url:
        raise ValueError("the exact Indeed listing URL is unavailable for this stale handoff")
    opened = open_browser_url(recovery_url)
    goal, items = _goal_state()
    active_goal_id = ""
    if str(goal.get("status", "")) in _CURRENT_GOAL_STATUSES and any(
        str(item.get("task_id", "")) == entry.task_id for item in items
    ):
        active_goal_id = str(goal.get("id", ""))
    updated = queue.reattach_target(
        entry.id,
        browser_target_id=opened["target_id"],
        goal_id=active_goal_id,
    )
    return {
        "entry_id": updated.id,
        "target_id": updated.browser_target_id,
        "url": opened["url"],
    }


def reopen_goal_item(goal_id: str, task_id: str) -> dict[str, str]:
    """Create a recoverable queue entry for a stranded goal handoff."""
    from .job_finder_supervisor import goal_store

    store = goal_store()
    goal = store.get(goal_id)
    item = store.item(goal_id, task_id)
    if item.state.value != "human_handoff":
        raise ValueError("only a human-handoff goal item can be reopened")
    recovery_url = _listing_url_for_task(task_id)
    if not recovery_url:
        raise ValueError("the exact Indeed listing URL is unavailable")
    opened = open_browser_url(recovery_url)
    action = (
        InterventionAction.LAYOUT_REVIEW
        if "unknown" in item.detail.casefold()
        else InterventionAction.HUMAN_VERIFICATION
    )
    entry = _queue().enqueue_handoff(
        application_reference=f"{item.company} — {item.job_title}",
        url=recovery_url,
        reason=action.value,
        browser_target_id=opened["target_id"],
        action=action,
        task_id=task_id,
        company=item.company,
        job_title=item.job_title,
        goal_id=goal.id,
    )
    return {"entry_id": entry.id, "target_id": opened["target_id"], "url": opened["url"]}


def release_intervention(entry_id: str) -> dict[str, object]:
    """Resolve and release only the goal item represented by one queue entry."""
    from .job_finder_supervisor import goal_store, release_item

    queue = _queue()
    entry = queue.get(entry_id)
    if entry is None:
        raise KeyError(entry_id)
    if not entry.goal_id:
        queue.resolve(entry_id)
        return {"released": True, "goal_id": "", "task_id": entry.task_id}
    if not entry.task_id:
        raise ValueError("this intervention is not attached to an active goal")
    store = goal_store()
    goal_id = entry.goal_id
    try:
        store.item(goal_id, entry.task_id)
    except KeyError:
        active = store.active()
        if active is None:
            raise ValueError("this intervention is not attached to an active goal") from None
        store.item(active.id, entry.task_id)
        goal_id = active.id
    goal = release_item(goal_id, entry.task_id)
    queue.resolve(entry_id)
    return {"released": True, "goal_id": goal.id, "task_id": entry.task_id}


def retry_intervention(entry_id: str) -> dict[str, object]:
    """Resolve one review handoff and queue its exact goal item for replay."""
    from .job_finder_supervisor import goal_store, retry_item

    queue = _queue()
    entry = queue.get(entry_id)
    if entry is None:
        raise KeyError(entry_id)
    if entry.action != InterventionAction.LAYOUT_REVIEW:
        raise ValueError("only a reviewed layout handoff can use deterministic retry")
    if not entry.task_id:
        raise ValueError("this intervention is not attached to an active goal")
    store = goal_store()
    goal_id = entry.goal_id
    try:
        store.item(goal_id, entry.task_id)
    except KeyError:
        active = store.active()
        if active is None:
            raise ValueError("this intervention is not attached to an active goal") from None
        store.item(active.id, entry.task_id)
        goal_id = active.id
    goal = retry_item(goal_id, entry.task_id)
    queue.resolve(entry_id)
    return {"retried": True, "goal_id": goal.id, "task_id": entry.task_id}


def approve_resume_intervention(entry_id: str) -> dict[str, Any]:
    queue = _queue()
    entry = next((item for item in queue.pending() if item.id == entry_id), None)
    if entry is None:
        raise KeyError(entry_id)
    target = next(
        (item for item in _targets() if str(item.get("id", "")) == entry.browser_target_id),
        None,
    )
    if target is None:
        raise ValueError("the saved resume-review tab is no longer open")
    parts = urlsplit(str(target.get("url", "")))
    if (parts.hostname or "").casefold() != "smartapply.indeed.com" or (
        "/resume-module" not in parts.path
    ):
        raise ValueError("the exact Indeed resume-review page is no longer open")
    approved = queue.approve_action(entry_id)
    return {
        "approved": True,
        "entry_id": approved.id,
        "application_reference": approved.application_reference,
        "action": approved.action.value,
    }


def confirm_external_intervention(entry_id: str) -> dict[str, Any]:
    """Persist one explicit human confirmation and resolve its exact external handoff."""
    queue = _queue()
    entry = queue.get(entry_id)
    if entry is None:
        raise KeyError(entry_id)
    if entry.action != InterventionAction.EXTERNAL_APPLICATION:
        raise ValueError("only external applications can be manually confirmed here")
    if not entry.company or not entry.job_title:
        raise ValueError("external handoff has no structured company/job-title identity")

    goal_id = entry.goal_id
    if not goal_id and entry.task_id:
        goal, items = _goal_state()
        if any(str(item.get("task_id", "")) == entry.task_id for item in items):
            goal_id = str(goal.get("id", ""))

    if goal_id and entry.task_id:
        from .job_finder_supervisor import confirm_item

        confirm_item(goal_id, entry.task_id, source_url=entry.url)
    else:
        from datetime import datetime, timezone

        ApplicationSubmissionHistory(DEFAULT_DATABASE).record_existing_submission(
            company=entry.company,
            job_title=entry.job_title,
            applied_at=datetime.now(timezone.utc),
            confirmation="explicit manual confirmation from local control center",
            confirmation_source=ConfirmationSource.MANUAL,
            source_url=entry.url,
        )
    resolved = queue.resolve(entry.id)
    if resolved is None:
        raise RuntimeError("submission was recorded but the intervention could not be resolved")
    return {
        "confirmed": True,
        "entry_id": entry.id,
        "goal_id": goal_id,
        "task_id": entry.task_id,
    }


def open_browser_url(url: str) -> dict[str, str]:
    return open_tab(url)


def start_session(provider: str) -> dict[str, str]:
    if provider not in _SIGN_IN_URLS:
        raise KeyError(provider)
    return open_browser_url(_SIGN_IN_URLS[provider])


def disconnect_provider(provider: str, *, website_logout: bool) -> dict[str, Any]:
    if provider not in _PROVIDERS:
        raise KeyError(provider)
    cleared = False
    if provider in {"github", "google", "microsoft"}:
        cleared = IdentityStore().clear_profile(provider)
    elif provider in _SOCIAL_PROVIDERS:
        cleared = clear_social_session(provider)
    opened = None
    if website_logout:
        opened = open_browser_url(_WEBSITE_LOGOUT_URLS[provider])
    return {"provider": provider, "cleared": cleared, "website_logout": opened}


def recheck_intervention(entry_id: str) -> dict[str, Any]:
    queue = _queue()
    entry = next((item for item in queue.pending() if item.id == entry_id), None)
    if entry is None:
        raise KeyError(entry_id)
    if not entry.browser_target_id:
        return {"resolved": False, "reason": "No live browser target is attached."}

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(_cdp_url(), timeout=5_000)
        page = None
        for context in browser.contexts:
            for candidate in context.pages:
                session = context.new_cdp_session(candidate)
                try:
                    info = session.send("Target.getTargetInfo")
                    if (
                        str(info.get("targetInfo", {}).get("targetId", ""))
                        == entry.browser_target_id
                    ):
                        page = candidate
                        break
                finally:
                    session.detach()
            if page is not None:
                break
        if page is None:
            return {"resolved": False, "reason": "The saved browser tab is no longer open."}
        if entry.action == InterventionAction.UNKNOWN_QUESTION:
            return {
                "resolved": False,
                "reason": "Use Save answers & continue for unknown questions.",
            }
        if entry.action in {
            InterventionAction.CAPTCHA,
            InterventionAction.HUMAN_VERIFICATION,
            InterventionAction.SIGN_IN,
        }:
            access = check_access_gate(page)
            clear = not access.blocked
            reason = "access gate clear" if clear else access.reason
        else:
            return {"resolved": False, "reason": "This task requires explicit manual completion."}
    if clear:
        queue.resolve(entry.id)
    return {
        "resolved": clear,
        "reason": reason,
        "application_reference": entry.application_reference,
    }


def approve_question_answers(entry_id: str) -> dict[str, Any]:
    """Validate one exact live questionnaire, save safe answers, and approve one replay."""
    queue = _queue()
    entry = next((item for item in queue.pending() if item.id == entry_id), None)
    if entry is None:
        raise KeyError(entry_id)
    if entry.action != InterventionAction.UNKNOWN_QUESTION:
        raise ValueError("only unknown-question handoffs use this action")
    if not entry.browser_target_id:
        raise ValueError("question handoff has no live browser target")

    from playwright.sync_api import sync_playwright

    from ..job_application import (
        DEFAULT_MONGODB_DATABASE,
        DEFAULT_MONGODB_URI,
        MongoQuestionnaireRepository,
        observe_indeed_question_answers,
        observe_indeed_screening_questions,
        question_set_fingerprint,
    )
    from ..job_application.intelligence.smart_apply_questions import (
        is_reusable_question_label,
    )

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(_cdp_url(), timeout=5_000)
        page = None
        for context in browser.contexts:
            for candidate in context.pages:
                session = context.new_cdp_session(candidate)
                try:
                    info = session.send("Target.getTargetInfo")
                    if (
                        str(info.get("targetInfo", {}).get("targetId", ""))
                        == entry.browser_target_id
                    ):
                        page = candidate
                        break
                finally:
                    session.detach()
            if page is not None:
                break
        if page is None:
            raise ValueError("the saved questionnaire tab is no longer open")
        if (urlsplit(str(page.url)).hostname or "").casefold() != "smartapply.indeed.com" or (
            "/questions-module" not in urlsplit(str(page.url)).path
        ):
            raise ValueError("the exact questionnaire page is no longer open")
        questions = observe_indeed_screening_questions(page)
        if not questions:
            raise ValueError("no questionnaire fields were observed")
        answers = observe_indeed_question_answers(page, questions)
        missing = [
            question.label
            for question in questions
            if question.required and not answers.get(question.question_id)
        ]
        if missing:
            raise ValueError("required answers are missing: " + " · ".join(missing[:6]))
        for question in questions:
            answer = answers.get(question.question_id, "")
            if answer and question.options and answer not in question.options:
                raise ValueError(f"answer does not match an observed option: {question.label}")
            if answer and question.max_length and len(answer) > question.max_length:
                raise ValueError(f"answer exceeds the field limit: {question.label}")
        fingerprint = question_set_fingerprint(questions)
        safe_answers = {
            question.question_id: answers[question.question_id]
            for question in questions
            if question.question_id in answers and is_reusable_question_label(question.label)
        }
        repository = MongoQuestionnaireRepository(
            DEFAULT_MONGODB_URI,
            database=DEFAULT_MONGODB_DATABASE,
        )
        try:
            repository.ping()
            repository.save_observed_page(
                questions,
                safe_answers,
                domain="smartapply.indeed.com",
                source="explicit control-center human approval",
            )
        finally:
            repository.close()
    approved = queue.approve_question(entry.id, question_fingerprint=fingerprint)
    return {
        "approved": True,
        "entry_id": approved.id,
        "application_reference": approved.application_reference,
        "saved_answers": len(safe_answers),
        "question_count": len(questions),
    }
