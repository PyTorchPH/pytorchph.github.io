"""Collect a bounded Indeed manifest using deterministic live search controls.

This is the job-finder stage only. It never opens an application form, uploads a
resume, or clicks an Apply control. The resulting manifest is consumed separately
by ``run_indeed_unattended.py``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = next(path for path in Path(__file__).resolve().parents if (path / "pyproject.toml").exists())
sys.path.insert(0, str(ROOT / "legacy" / "python"))

from resume_builder.job_application import (  # noqa: E402
    ApplicationSubmissionHistory,
    ApplicationGoalStore,
    JobLevel,
    SalaryBand,
    HumanVerificationQueue,
    InterventionAction,
    classify_job_level,
    parse_salary_signal,
)
from resume_builder.job_application.indeed_unattended import (  # noqa: E402
    IndeedUnattendedJob,
    IndeedUnattendedManifest,
    has_recent_exact_submission,
)
from resume_builder.job_finder import (  # noqa: E402
    AccessGuard,
    INDEED_ADAPTER,
    JobListing,
    WorkMode,
    apply_listing_rules,
)
try:  # noqa: E402 - supports both direct CLI execution and package-style unit imports
    from tools.job_finder.sync_indeed_applied import sync_page
except ModuleNotFoundError:  # pragma: no cover - direct script path
    from sync_indeed_applied import sync_page

_COUNTRY_HOSTS = {
    "Philippines": "ph.indeed.com",
    "Australia": "au.indeed.com",
    "Canada": "ca.indeed.com",
}
_DEFAULT_KEYWORDS = (
    "junior machine learning engineer",
    "junior data automation",
    "junior python developer",
    "entry level backend software engineer",
    "software engineer intern",
    "data analyst intern",
)
_TITLE_BLOCKERS = re.compile(
    r"\b(senior|staff|principal|architect|manager|director|head|lead|sales|"
    r"business development|account executive|marketing|recruiter|talent acquisition)\b",
    re.IGNORECASE,
)
_ROLE_PROFILES = (
    (
        re.compile(
            r"\b(data analyst|data engineer|automation|analytics|business intelligence)\b",
            re.I,
        ),
        "automation-data.pdf",
        ("data", "automation", "analytics", "business intelligence"),
    ),
    (
        re.compile(
            r"\b(machine learning|artificial intelligence|ai |ai-|llm|data scientist|"
            r"ai trainer|ai agent|ml)\b",
            re.I,
        ),
        "ai-ml-research.pdf",
        (
            "machine learning",
            "artificial intelligence",
            "data scientist",
            "llm",
            "ai agent",
            "ai trainer",
        ),
    ),
    (
        re.compile(
            r"\b(software|backend|back-end|front end|front-end|frontend|full stack|"
            r"full-stack|web developer|python developer)\b",
            re.I,
        ),
        "software-systems.pdf",
        (
            "software",
            "backend",
            "back-end",
            "frontend",
            "front-end",
            "full stack",
            "full-stack",
            "web developer",
        ),
    ),
)
_DESCRIPTION_BLOCKERS = (
    "must reside in australia",
    "australian residents only",
    "candidates located in australia only",
    "must be located in australia",
    "must reside in canada",
    "canadian residents only",
    "must be located in canada",
    "minimum 2 years",
    "minimum of 2 years",
    "at least 2 years",
    "2+ years of professional",
    "minimum 3 years",
    "minimum of 3 years",
    "at least 3 years",
    "3+ years",
    "minimum 5 years",
    "minimum of 5 years",
    "at least 5 years",
    "5+ years",
    "bilingual required",
    "fluent in french",
    "french and english required",
    "mandarin required",
)
_REMOTE_TERMS = ("remote", "work from home", "work from anywhere", "fully remote")
_CONTRACT_TERMS = (
    "contract",
    "contractor",
    "fixed term",
    "fixed-term",
    "temporary contract",
)
_INDEED_JOB_TYPE_BUTTON = 'button[aria-label^="Job Type filter" i]'
_INDEED_CONTRACT_OPTION = '[role=menuitemcheckbox][aria-label="Contract"]'
_EMPLOYMENT_LABELS = {
    "full_time": "Full-time",
    "contract": "Contract",
    "internship": "Internship",
}
_EARLY_CAREER_TERMS = (
    "intern",
    "internship",
    "student",
    "graduate",
    "entry level",
    "entry-level",
    "early career",
)


def _browser_target_id(page) -> str:
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


def _inventory_report(
    *,
    status: str,
    source_url: str = "",
    pages_scanned: int = 0,
    items: list[dict[str, str]] | None = None,
    applied_sync: dict[str, int | str] | None = None,
    warning: str = "",
) -> dict[str, object]:
    inventory_items = items or []
    counts = Counter(str(item.get("status", "filtered")) for item in inventory_items)
    parts = urlsplit(source_url)
    return {
        "schema_version": 1,
        "status": status,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "site": "indeed",
            "host": (parts.hostname or "").lower(),
            "safe_path": parts.path or "",
            "fingerprint": (
                hashlib.sha256(source_url.encode()).hexdigest()[:16] if source_url else ""
            ),
        },
        "pages_scanned": pages_scanned,
        "observed": len(inventory_items),
        "eligible": counts.get("eligible", 0),
        "already_applied": counts.get("already_applied", 0),
        "attempted": counts.get("attempted", 0),
        "filtered": sum(
            value
            for key, value in counts.items()
            if key not in {"eligible", "already_applied", "attempted"}
        ),
        "reason_counts": dict(sorted(counts.items())),
        "applied_sync": applied_sync or {"status": "not_available"},
        "warning": warning[:300],
        "items": inventory_items,
    }


def _write_inventory(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temporary.replace(path)


def _clean(value: str | None) -> str:
    return " ".join((value or "").split())


def canonical_indeed_listing_url(value: str, *, host: str) -> str:
    """Reduce Indeed card redirects to the stable host + ``/viewjob?jk=`` identity."""
    key = parse_qs(urlsplit(value).query).get("jk", [""])[0].strip()
    if not key or not re.fullmatch(r"[A-Za-z0-9]+", key):
        return ""
    return f"https://{host}/viewjob?jk={key}"


def candidate_from_listing(
    listing: JobListing,
    *,
    target_country: str,
    employment_type: str | list[str] = "any",
    job_levels: list[str] | None = None,
) -> IndeedUnattendedJob | None:
    """Map one rendered card to a conservative, auditable application candidate."""
    host = _COUNTRY_HOSTS[target_country]
    title = _clean(listing.title)
    company = _clean(listing.company)
    if not title or not company or _TITLE_BLOCKERS.search(title):
        return None
    level = classify_job_level(title, listing.experience_level)
    selected_levels = {JobLevel(value) for value in job_levels} if job_levels else set()
    if selected_levels and level not in selected_levels:
        return None
    matched_profile = next(
        (
            (resume_file, role_terms)
            for pattern, resume_file, role_terms in _ROLE_PROFILES
            if pattern.search(title)
        ),
        None,
    )
    if matched_profile is None:
        return None
    listing_url = canonical_indeed_listing_url(listing.detail_url or "", host=host)
    if not listing_url:
        return None
    resume_file, role_terms = matched_profile
    key = parse_qs(urlsplit(listing_url).query)["jk"][0]
    legacy_type = isinstance(employment_type, str)
    selected_types = [employment_type] if legacy_type else employment_type
    selected_types = [item for item in selected_types if item != "any"]
    listing_type = _classify_employment_type(listing.employment_type, title)
    if legacy_type and not listing_type and selected_types:
        listing_type = selected_types[0]
    if selected_types and listing_type and listing_type not in selected_types:
        return None
    required_groups = [list(role_terms), list(_REMOTE_TERMS)]
    if listing_type == "contract":
        required_groups.append(list(_CONTRACT_TERMS))
    if re.search(r"\b(intern|internship|graduate|entry.level|student)\b", title, re.I):
        required_groups.append(list(_EARLY_CAREER_TERMS))
    slug = re.sub(r"[^a-z0-9]+", "-", f"{company}-{title}".casefold()).strip("-")[:72]
    salary = parse_salary_signal(listing.salary_signal)
    return IndeedUnattendedJob(
        task_id=f"{slug}-{key}",
        company=company,
        job_title=title,
        listing_url=listing_url,
        target_country=target_country,
        work_mode="remote",
        resume_file=resume_file,
        employment_type=listing_type,
        job_level=level,
        salary_signal=salary.raw,
        salary_monthly_min_php=salary.monthly_min_php,
        salary_monthly_max_php=salary.monthly_max_php,
        salary_band=salary.band,
        required_any_groups=required_groups,
        blocked_terms=list(_DESCRIPTION_BLOCKERS),
    )


def _classify_employment_type(value: str | None, title: str) -> str:
    evidence = f"{value or ''} {title}".casefold()
    if re.search(r"\b(intern|internship|ojt|trainee)\b", evidence):
        return "internship"
    if re.search(r"\b(contract|contractor|fixed[ -]?term|temporary)\b", evidence):
        return "contract"
    if re.search(r"\b(full[ -]?time|permanent)\b", evidence):
        return "full_time"
    return ""


def _stable_content(page, *, attempts: int = 40) -> str:
    for _ in range(attempts):
        try:
            html = page.content()
            if html.strip():
                return html
        except Exception:
            pass
        page.wait_for_timeout(250)
    raise RuntimeError("rendered page content did not stabilize")


def _apply_employment_type_filter(page, *, employment_types: list[str]) -> bool:
    """Apply an observed Indeed Job Type option; return false when unavailable."""
    selected_types = [item for item in employment_types if item != "any"]
    if not selected_types or len(selected_types) > 1:
        return True
    employment_type = selected_types[0]
    if employment_type not in _EMPLOYMENT_LABELS:
        raise ValueError(f"unsupported employment type: {employment_type}")

    button = page.locator(_INDEED_JOB_TYPE_BUTTON).first
    if not button.count() or not button.is_visible():
        raise RuntimeError("Indeed adapter drift: visible Job Type filter is unavailable")
    if button.get_attribute("aria-expanded") != "true":
        button.click(no_wait_after=True)
        page.wait_for_timeout(250)

    label = _EMPLOYMENT_LABELS[employment_type]
    option = page.locator(f'[role=menuitemcheckbox][aria-label="{label}"]').first
    if not option.count() or not option.is_visible():
        page.keyboard.press("Escape")
        return False
    if option.get_attribute("aria-checked") != "true":
        option.click(no_wait_after=True)

    update = page.get_by_role("button", name="Update", exact=True)
    if not update.count() or not update.is_visible():
        raise RuntimeError("Indeed adapter drift: Job Type Update control is unavailable")
    previous_url = page.url
    update.click(no_wait_after=True)
    try:
        page.wait_for_url(lambda url: url != previous_url, timeout=10_000)
    except Exception:
        pass
    try:
        page.locator("div.job_seen_beacon").first.wait_for(state="attached", timeout=10_000)
    except Exception:
        pass
    page.wait_for_timeout(1_000)

    decision = AccessGuard().classify(url=page.url, html=_stable_content(page))
    if not decision.should_continue:
        raise RuntimeError(f"Job Type filter access gate requires human handoff: {decision.reason}")
    applied = page.locator(_INDEED_JOB_TYPE_BUTTON).first
    if not applied.count() or not applied.is_visible():
        raise RuntimeError("Indeed did not retain the visible Job Type filter control")
    applied.click(no_wait_after=True)
    page.wait_for_timeout(250)
    selected = page.locator(f'[role=menuitemcheckbox][aria-label="{label}"]').first
    is_selected = (
        selected.count()
        and selected.is_visible()
        and selected.get_attribute("aria-checked") == "true"
    )
    page.keyboard.press("Escape")
    if not is_selected:
        raise RuntimeError(f"Indeed did not visibly confirm the selected {label} Job Type option")
    return True


def _execute_search(
    page,
    *,
    keyword: str,
    employment_types: list[str] | None = None,
) -> list[JobListing]:
    html = _stable_content(page)
    decision = AccessGuard().classify(url=page.url, html=html)
    if not decision.should_continue:
        raise RuntimeError(f"access gate requires human handoff: {decision.reason}")
    plan = INDEED_ADAPTER.build_search_plan(
        page.url,
        html,
        keyword=keyword,
        work_mode=WorkMode.REMOTE,
    )
    for step in plan.steps:
        locator = page.locator(step.selector).first
        locator.wait_for(state="visible", timeout=10_000)
        if step.action == "fill":
            locator.fill(step.value or "")
        elif step.action == "click":
            # Indeed's rendered autocomplete backdrop can remain above the verified
            # Search button after filling What/Where. Dismiss that normal UI layer
            # first; if the same button is still covered, submit the visible search
            # form through its location control rather than forcing a hidden click.
            page.keyboard.press("Escape")
            try:
                locator.click(no_wait_after=True, timeout=5_000)
            except Exception as click_error:
                location = page.locator('input[name="l"], input[aria-label*="location" i]').first
                if not location.count() or not location.is_visible():
                    raise RuntimeError(
                        "Indeed search control remained obstructed and no visible location control could submit the form"
                    ) from click_error
                location.press("Enter")
        else:
            raise RuntimeError(f"unsupported deterministic search action: {step.action}")
    try:
        page.wait_for_load_state("domcontentloaded", timeout=10_000)
    except Exception:
        # Indeed may leave background requests pending after the rendered results update.
        pass
    try:
        page.locator("div.job_seen_beacon").first.wait_for(state="attached", timeout=10_000)
    except Exception:
        pass
    page.wait_for_timeout(2_000)
    html = _stable_content(page)
    decision = AccessGuard().classify(url=page.url, html=html)
    if not decision.should_continue:
        raise RuntimeError(f"search result access gate requires human handoff: {decision.reason}")
    if not _apply_employment_type_filter(page, employment_types=employment_types or ["any"]):
        return []
    html = _stable_content(page)
    layout = INDEED_ADAPTER.build_listing_layout(page.url, html)
    listings, _, _, _ = apply_listing_rules(
        html,
        page.url,
        f"{urlsplit(page.url).scheme}://{urlsplit(page.url).netloc}",
        layout.rules,
    )
    return listings


def collect_current_search(
    args: argparse.Namespace,
) -> tuple[list[IndeedUnattendedJob], dict[str, object]]:
    """Inventory one open Indeed results URL without submitting another search."""
    from playwright.sync_api import sync_playwright

    history = ApplicationSubmissionHistory(args.database)
    excluded_task_ids: set[str] = set()
    if args.exclude_task_ids and args.exclude_task_ids.is_file():
        loaded = json.loads(args.exclude_task_ids.read_text(encoding="utf-8"))
        if not isinstance(loaded, list):
            raise ValueError("exclude-task-ids must contain a JSON array")
        excluded_task_ids = {str(item) for item in loaded}

    band_capacity: dict[SalaryBand, int] = {}
    if args.goal_id:
        goal_store = ApplicationGoalStore(args.database)
        goal = goal_store.get(args.goal_id)
        used = {band: 0 for band in goal.salary_targets}
        for item in goal_store.items(args.goal_id):
            if item.state.value in {"reserved", "confirmed"}:
                used[item.salary_band] = used.get(item.salary_band, 0) + 1
        band_capacity = {
            band: max(0, goal.salary_targets.get(band, 0) - used.get(band, 0))
            for band in goal.salary_targets
        }

    selected: list[IndeedUnattendedJob] = []
    selected_by_band: dict[SalaryBand, int] = {}
    identities: set[tuple[str, str]] = set()
    listing_keys: set[tuple[str, str]] = set()
    items: list[dict[str, str]] = []
    applied_sync: dict[str, int | str] = {"status": "not_available"}
    warning = ""

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(args.cdp_url)
        if not browser.contexts:
            report = _inventory_report(status="source_missing", warning="Chrome has no context")
            return [], report
        context = browser.contexts[0]
        allowed_hosts = {_COUNTRY_HOSTS[country]: country for country in args.target_country}
        search_pages = [
            page
            for page in context.pages
            if (urlsplit(page.url).hostname or "").lower() in allowed_hosts
            and urlsplit(page.url).path.rstrip("/") == "/jobs"
        ]
        visible_pages = []
        for page in search_pages:
            try:
                if page.evaluate("document.visibilityState") == "visible":
                    visible_pages.append(page)
            except Exception:
                pass
        if len(visible_pages) == 1:
            source_page = visible_pages[0]
        elif len(search_pages) == 1:
            source_page = search_pages[0]
        else:
            detail = (
                "Open one Indeed search-results tab before scanning."
                if not search_pages
                else "Keep only one active Indeed search-results tab before scanning."
            )
            return [], _inventory_report(
                status="source_missing",
                warning=detail,
            )

        source_url = str(source_page.url)
        country = allowed_hosts[(urlsplit(source_url).hostname or "").lower()]
        applied_pages = [
            page
            for page in context.pages
            if urlsplit(page.url).hostname == "myjobs.indeed.com"
            and urlsplit(page.url).path == "/applied"
        ]
        if applied_pages:
            try:
                applied_sync = sync_page(
                    applied_pages[-1],
                    database=args.database,
                    timezone_name=args.timezone,
                )
            except (RuntimeError, ValueError) as exc:
                applied_sync = {"status": "failed"}
                warning = f"Applied sync skipped: {exc}"
        else:
            warning = "Applied page is not open; existing confirmed history was used."

        scan_page = context.new_page()
        keep_page = False
        pages_scanned = 0
        try:
            scan_page.goto(source_url, wait_until="domcontentloaded", timeout=15_000)
            next_url = source_url
            visited: set[str] = set()
            while next_url and pages_scanned < args.max_pages and len(selected) < args.max_candidates:
                if next_url in visited:
                    break
                visited.add(next_url)
                if pages_scanned and scan_page.url != next_url:
                    scan_page.goto(next_url, wait_until="domcontentloaded", timeout=15_000)
                scan_page.wait_for_timeout(1_000)
                html = _stable_content(scan_page)
                decision = AccessGuard().classify(url=scan_page.url, html=html)
                if not decision.should_continue:
                    action = (
                        InterventionAction.CAPTCHA
                        if "captcha" in decision.reason.casefold()
                        else InterventionAction.HUMAN_VERIFICATION
                    )
                    HumanVerificationQueue(args.queue).enqueue_handoff(
                        application_reference=f"Indeed candidate scan — {args.goal_id or 'manual'}",
                        url=str(scan_page.url),
                        reason=decision.reason,
                        browser_target_id=_browser_target_id(scan_page),
                        action=action,
                        goal_id=args.goal_id,
                    )
                    keep_page = True
                    report = _inventory_report(
                        status="human_required",
                        source_url=source_url,
                        pages_scanned=pages_scanned,
                        items=items,
                        applied_sync=applied_sync,
                        warning=decision.reason,
                    )
                    return selected, report
                layout = INDEED_ADAPTER.build_listing_layout(scan_page.url, html)
                listings, next_urls, _, _ = apply_listing_rules(
                    html,
                    scan_page.url,
                    f"{urlsplit(scan_page.url).scheme}://{urlsplit(scan_page.url).netloc}",
                    layout.rules,
                )
                pages_scanned += 1
                for listing in listings:
                    candidate = candidate_from_listing(
                        listing,
                        target_country=country,
                        employment_type=args.employment_type,
                        job_levels=args.job_level,
                    )
                    item = {
                        "company": _clean(listing.company),
                        "job_title": _clean(listing.title),
                        "task_id": candidate.task_id if candidate else "",
                        "status": "filtered_profile_or_level",
                    }
                    if candidate is None:
                        items.append(item)
                        continue
                    identity = (
                        " ".join(candidate.company.casefold().split()),
                        " ".join(candidate.job_title.casefold().split()),
                    )
                    host = (urlsplit(candidate.listing_url).hostname or "").lower()
                    key = parse_qs(urlsplit(candidate.listing_url).query)["jk"][0]
                    listing_identity = (host, key)
                    status = "eligible"
                    if candidate.task_id in excluded_task_ids:
                        status = "attempted"
                    elif identity in identities or listing_identity in listing_keys:
                        status = "duplicate_in_inventory"
                    elif has_recent_exact_submission(
                        history,
                        company=candidate.company,
                        job_title=candidate.job_title,
                        within_days=args.duplicate_days,
                    ):
                        status = "already_applied"
                    elif band_capacity and candidate.salary_band != SalaryBand.UNKNOWN and (
                        selected_by_band.get(candidate.salary_band, 0)
                        >= band_capacity.get(candidate.salary_band, 0)
                    ):
                        status = "salary_band_full"
                    elif candidate.salary_band == SalaryBand.UNKNOWN and (
                        selected_by_band.get(SalaryBand.UNKNOWN, 0) >= 3
                    ):
                        status = "unknown_salary_limit"
                    item["status"] = status
                    items.append(item)
                    identities.add(identity)
                    listing_keys.add(listing_identity)
                    if status != "eligible":
                        continue
                    selected.append(candidate)
                    selected_by_band[candidate.salary_band] = (
                        selected_by_band.get(candidate.salary_band, 0) + 1
                    )
                    if len(selected) >= args.max_candidates:
                        break
                next_url = next_urls[0] if next_urls else ""
        finally:
            if not keep_page:
                scan_page.close()

    status = "ready" if selected else "exhausted"
    return selected, _inventory_report(
        status=status,
        source_url=source_url,
        pages_scanned=pages_scanned,
        items=items,
        applied_sync=applied_sync,
        warning=warning,
    )


def collect(args: argparse.Namespace) -> IndeedUnattendedManifest:
    from playwright.sync_api import sync_playwright

    history = ApplicationSubmissionHistory(args.database)
    selected: list[IndeedUnattendedJob] = []
    identities: set[tuple[str, str]] = set()
    listing_keys: set[tuple[str, str]] = set()
    excluded_task_ids: set[str] = set()
    band_capacity: dict[SalaryBand, int] = {}
    goal_id = str(getattr(args, "goal_id", "") or "").strip()
    if goal_id:
        goal_store = ApplicationGoalStore(args.database)
        goal = goal_store.get(goal_id)
        used = {band: 0 for band in goal.salary_targets}
        for item in goal_store.items(goal_id):
            if item.state.value in {"reserved", "confirmed"}:
                used[item.salary_band] = used.get(item.salary_band, 0) + 1
        band_capacity = {
            band: max(0, goal.salary_targets.get(band, 0) - used.get(band, 0))
            for band in goal.salary_targets
        }
    selected_by_band: dict[SalaryBand, int] = {}
    excluded_path = getattr(args, "exclude_task_ids", None)
    if excluded_path and excluded_path.is_file():
        try:
            loaded = json.loads(excluded_path.read_text(encoding="utf-8"))
            if isinstance(loaded, list):
                excluded_task_ids = {str(item) for item in loaded}
        except (OSError, json.JSONDecodeError):
            raise ValueError("exclude-task-ids must contain a JSON array") from None
    country_limit = (args.max_candidates + len(args.target_country) - 1) // len(args.target_country)

    def add_candidate(candidate: IndeedUnattendedJob | None) -> bool:
        if candidate is None:
            return False
        if candidate.task_id in excluded_task_ids:
            return False
        if band_capacity and candidate.salary_band != SalaryBand.UNKNOWN:
            if selected_by_band.get(candidate.salary_band, 0) >= band_capacity.get(
                candidate.salary_band, 0
            ):
                return False
        if (
            candidate.salary_band == SalaryBand.UNKNOWN
            and selected_by_band.get(SalaryBand.UNKNOWN, 0) >= 3
        ):
            return False
        if args.employment_type == ["contract"] and not any(
            set(map(str.casefold, group)) & set(_CONTRACT_TERMS)
            for group in candidate.required_any_groups
        ):
            return False
        host = (urlsplit(candidate.listing_url).hostname or "").lower()
        identity = (
            " ".join(candidate.company.casefold().split()),
            " ".join(candidate.job_title.casefold().split()),
        )
        key = parse_qs(urlsplit(candidate.listing_url).query)["jk"][0]
        listing_identity = (host, key)
        if identity in identities or listing_identity in listing_keys:
            return False
        if has_recent_exact_submission(
            history,
            company=candidate.company,
            job_title=candidate.job_title,
            within_days=args.duplicate_days,
        ):
            return False
        identities.add(identity)
        listing_keys.add(listing_identity)
        selected.append(candidate)
        selected_by_band[candidate.salary_band] = selected_by_band.get(candidate.salary_band, 0) + 1
        return True

    for seed_path in getattr(args, "seed_manifest", []):
        seed = IndeedUnattendedManifest.model_validate_json(seed_path.read_text(encoding="utf-8"))
        for candidate in seed.jobs:
            add_candidate(candidate)
            if len(selected) >= args.max_candidates:
                return IndeedUnattendedManifest(jobs=selected)

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(args.cdp_url)
        if not browser.contexts:
            raise RuntimeError("Chrome has no browser context")
        context = browser.contexts[0]
        if args.open_tabs_only:
            allowed = {_COUNTRY_HOSTS[country]: country for country in args.target_country}
            for page in context.pages:
                parts = urlsplit(page.url)
                host = (parts.hostname or "").lower()
                if host not in allowed or parts.path.rstrip("/") != "/viewjob":
                    continue
                html = _stable_content(page)
                decision = AccessGuard().classify(url=page.url, html=html)
                if not decision.should_continue:
                    raise RuntimeError(
                        f"open-tab access gate requires human handoff: {decision.reason}"
                    )
                title_locator = page.locator("h1").first
                company_locator = page.locator(
                    "[data-testid=inlineHeader-companyName], [data-company-name=true]"
                ).first
                listing = JobListing(
                    title=title_locator.inner_text() if title_locator.count() else "",
                    company=company_locator.inner_text() if company_locator.count() else "",
                    detail_url=page.url,
                    source_url=page.url,
                )
                add_candidate(
                    candidate_from_listing(
                        listing,
                        target_country=allowed[host],
                        employment_type=args.employment_type,
                        job_levels=args.job_level,
                    )
                )
                if len(selected) >= args.max_candidates:
                    break
            if not selected:
                raise RuntimeError("no eligible current Indeed tabs were collected")
            return IndeedUnattendedManifest(jobs=selected)

        for country in args.target_country:
            host = _COUNTRY_HOSTS[country]
            country_count = 0
            page = next(
                (
                    candidate
                    for candidate in context.pages
                    if (urlsplit(candidate.url).hostname or "").lower() == host
                    and urlsplit(candidate.url).path.rstrip("/") == "/jobs"
                ),
                None,
            )
            owns_page = page is None
            if page is None:
                page = context.new_page()
            try:
                if owns_page:
                    try:
                        page.goto(
                            f"https://{host}/jobs",
                            wait_until="domcontentloaded",
                            timeout=15_000,
                        )
                    except Exception:
                        if (urlsplit(page.url).hostname or "").lower() != host:
                            raise
                        try:
                            page.evaluate("window.stop()")
                        except Exception:
                            pass
                page.wait_for_timeout(1_000)
                for keyword in args.keyword:
                    for listing in _execute_search(
                        page,
                        keyword=keyword,
                        employment_types=args.employment_type,
                    ):
                        candidate = candidate_from_listing(
                            listing,
                            target_country=country,
                            employment_type=args.employment_type,
                            job_levels=args.job_level,
                        )
                        if not add_candidate(candidate):
                            continue
                        country_count += 1
                        if len(selected) >= args.max_candidates:
                            return IndeedUnattendedManifest(jobs=selected)
                        if country_count >= country_limit:
                            break
                    if country_count >= country_limit:
                        break
            finally:
                if owns_page:
                    page.close()
    if not selected:
        raise RuntimeError("no eligible candidate cards were collected")
    return IndeedUnattendedManifest(jobs=selected)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    parser.add_argument(
        "--database",
        type=Path,
        default=ROOT / "var" / "state" / "job-applications" / "submissions.sqlite3",
    )
    parser.add_argument("--goal-id", default="")
    parser.add_argument("--queue", type=Path, default=ROOT / "var" / "state" / "job-applications" / "verification-queue.json")
    parser.add_argument("--inventory-output", type=Path)
    parser.add_argument("--current-search-only", action="store_true")
    parser.add_argument("--max-pages", type=int, default=3)
    parser.add_argument("--timezone", default="Asia/Manila")
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "out" / "indeed-unattended" / "candidate-manifest.json",
    )
    parser.add_argument(
        "--target-country",
        action="append",
        choices=tuple(_COUNTRY_HOSTS),
        required=True,
    )
    parser.add_argument("--keyword", action="append", default=[])
    parser.add_argument(
        "--employment-type",
        choices=("any", "full_time", "contract", "internship"),
        action="append",
        default=[],
        help=(
            "Require explicit employment-type evidence in the rendered title/description; "
            "contract never falls back to permanent or unspecified work."
        ),
    )
    parser.add_argument(
        "--job-level",
        choices=("junior", "intern"),
        action="append",
        default=[],
    )
    parser.add_argument(
        "--seed-manifest",
        action="append",
        type=Path,
        default=[],
        help="Merge reviewed candidates before live collection, preserving exact deduplication.",
    )
    parser.add_argument("--max-candidates", type=int, default=12)
    parser.add_argument(
        "--exclude-task-ids",
        type=Path,
        help="JSON array of listing task IDs already attempted by the active goal.",
    )
    parser.add_argument(
        "--open-tabs-only",
        action="store_true",
        help="Collect only currently open PH/AU/CA Indeed /viewjob tabs; do not run searches.",
    )
    parser.add_argument("--duplicate-days", type=int, default=30)
    return parser


def main() -> int:
    args = _parser().parse_args()
    if not args.keyword:
        args.keyword = list(_DEFAULT_KEYWORDS)
    if not args.employment_type:
        args.employment_type = ["any"]
    if not args.job_level:
        args.job_level = ["junior", "intern"]
    if not 1 <= args.max_candidates <= 24:
        raise SystemExit("--max-candidates must be between 1 and 24")
    if not 1 <= args.max_pages <= 5:
        raise SystemExit("--max-pages must be between 1 and 5")
    if args.current_search_only:
        try:
            current_jobs, inventory = collect_current_search(args)
        except Exception as exc:  # noqa: BLE001 - report deterministic scan failure to supervisor
            inventory = _inventory_report(status="error", warning=str(exc))
            current_jobs = []
        if args.inventory_output:
            _write_inventory(args.inventory_output, inventory)
        manifest = IndeedUnattendedManifest(jobs=current_jobs) if current_jobs else None
    else:
        manifest = collect(args)
        inventory = {"status": "ready"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(
        manifest.model_dump_json(indent=2) if manifest else json.dumps({"jobs": []}, indent=2),
        encoding="utf-8",
    )
    temporary.replace(args.output)
    print(f"Indeed candidate manifest: {args.output}", flush=True)
    jobs = manifest.jobs if manifest else []
    print(f"Candidates: {len(jobs)}", flush=True)
    for job in jobs:
        print(
            f"- {job.target_country} | {job.company} | {job.job_title} | {job.resume_file}",
            flush=True,
        )
    return {
        "ready": 0,
        "exhausted": 0,
        "source_missing": 2,
        "human_required": 3,
        "error": 4,
    }.get(str(inventory.get("status", "ready")), 4)


if __name__ == "__main__":
    raise SystemExit(main())
