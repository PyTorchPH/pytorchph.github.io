"""Capture and visualize job-finder rules against a user-approved Chrome session.

Development flow:
  python tools/job_finder/cdp_tag.py inventory --url "https://.../jobs?..."
  # current-session AI writes strict LearnedJobListingLayout JSON to --rules
  python tools/job_finder/cdp_tag.py apply --rules out/live-job-model/rules.json

Production/API flow:
  python tools/job_finder/cdp_tag.py api-plan

This tool never reads or writes cookies, never bypasses access controls, and stops
when the access guard detects verification, blocking, rate limiting, or sign-out.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = next(path for path in Path(__file__).resolve().parents if (path / "pyproject.toml").exists())
sys.path.insert(0, str(ROOT / "legacy" / "python"))

from resume_builder.job_finder import (
    AccessGuard,
    CountrySelectionPolicy,
    JobListingLayoutStore,
    JobListingPlanner,
    JobListingRun,
    JobScrapeArtifactStore,
    LearnedJobListingLayout,
    apply_listing_rules,
    build_listing_dom_inventory,
    fingerprint,
    render_rule_overlay,
    sanitize_debug_dom,
)
from resume_builder.llm.local_config import get_configured_provider

DEFAULT_OUTPUT = ROOT / "out" / "live-job-model"


def _country_selection_policy(args: argparse.Namespace) -> CountrySelectionPolicy | None:
    countries = tuple(args.target_country)
    if not args.foreign_only and not countries:
        return None
    try:
        policy = CountrySelectionPolicy(
            home_country=args.home_country,
            home_country_aliases=tuple(args.home_country_alias),
            selected_countries=countries,
            exclude_home_country=args.foreign_only,
        )
        for country in policy.selected_countries:
            policy.require_allowed(target_country=country, work_mode=args.work_mode)
    except ValueError as exc:
        raise SystemExit(f"Invalid foreign-country policy: {exc}") from exc
    return policy


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _capture(args: argparse.Namespace) -> int:
    from playwright.sync_api import sync_playwright

    country_policy = _country_selection_policy(args)
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(args.cdp_url)
        pages = [page for context in browser.contexts for page in context.pages]
        if not pages:
            print("STOP: no Chrome page is available over CDP", flush=True)
            return 2
        page = pages[args.page_index]
        if args.url:
            page.goto(args.url, wait_until="domcontentloaded", timeout=args.timeout_ms)
            page.wait_for_timeout(args.settle_ms)

        raw_html = page.content()
        decision = AccessGuard().classify(url=page.url, html=raw_html)
        metadata = {
            "url": page.url,
            "title": page.title(),
            "access_state": decision.state.value,
            "should_continue": decision.should_continue,
            "reason": decision.reason,
            "work_mode": args.work_mode,
            "foreign_country_policy": (
                country_policy.model_dump(mode="json") if country_policy else None
            ),
        }
        _write(args.output_dir / "access.json", json.dumps(metadata, indent=2))
        page.screenshot(path=str(args.output_dir / "access.png"), full_page=False)
        print(json.dumps(metadata, indent=2), flush=True)
        if not decision.should_continue:
            print("STOP: human handoff required; no inventory or model call was made", flush=True)
            return 2

        sanitized = sanitize_debug_dom(raw_html)
        inventory = build_listing_dom_inventory(sanitized, page.url)
        _write(args.output_dir / "source.html", sanitized)
        _write(args.output_dir / "inventory.txt", inventory)
        _write(
            args.output_dir / "capture.json",
            json.dumps(
                {
                    **metadata,
                    "layout_fingerprint": fingerprint(sanitized),
                    "inventory_nodes": len(inventory.splitlines()),
                },
                indent=2,
            ),
        )
        print(f"inventory: {args.output_dir / 'inventory.txt'}", flush=True)
        print(f"sanitized DOM: {args.output_dir / 'source.html'}", flush=True)
    return 0


def _load_capture(output_dir: Path) -> tuple[str, dict]:
    source_path = output_dir / "source.html"
    capture_path = output_dir / "capture.json"
    if not source_path.exists() or not capture_path.exists():
        raise SystemExit("Run the inventory phase first; source.html/capture.json is missing.")
    html = source_path.read_text(encoding="utf-8")
    capture = json.loads(capture_path.read_text(encoding="utf-8"))
    if capture.get("should_continue") is False:
        raise SystemExit("Captured access state requires human handoff; refusing to plan or apply.")
    decision = AccessGuard().classify(url=capture["url"], html=html)
    if not decision.should_continue:
        raise SystemExit(f"Captured DOM failed the access gate: {decision.reason}")
    return html, capture


def _validate_layout(layout: LearnedJobListingLayout, html: str, capture: dict) -> None:
    actual_fingerprint = fingerprint(html)
    if layout.layout_fingerprint != actual_fingerprint:
        raise SystemExit(
            "Rule fingerprint does not match the captured DOM: "
            f"rules={layout.layout_fingerprint}, capture={actual_fingerprint}"
        )
    captured_domain = urlsplit(capture["url"]).netloc.lower()
    if layout.domain.lower() != captured_domain:
        raise SystemExit(
            f"Rule domain does not match the capture: rules={layout.domain}, capture={captured_domain}"
        )


def _render_outputs(
    output_dir: Path,
    html: str,
    layout: LearnedJobListingLayout,
    run: JobListingRun,
    *,
    source_label: str,
    cdp_url: str,
) -> None:
    artifact = JobScrapeArtifactStore(output_dir / "runs").put(
        run,
        layout,
        source_label=source_label,
        rendered_dom=html,
    )
    overlay = render_rule_overlay(html, layout)
    _write(output_dir / "annotated.html", overlay)
    _write(output_dir / "latest.json", artifact.model_dump_json(indent=2))

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(cdp_url)
        context = browser.contexts[0]
        preview = context.new_page()
        try:
            preview.set_content(overlay, wait_until="load")
            preview.screenshot(path=str(output_dir / "annotated.png"), full_page=True)
        finally:
            preview.close()

    print(f"annotated HTML: {output_dir / 'annotated.html'}", flush=True)
    print(f"annotated screenshot: {output_dir / 'annotated.png'}", flush=True)
    print(f"extracted jobs: {len(run.listings)}", flush=True)
    for listing in run.listings:
        print(f"- {listing.title or '(untitled)'} | {listing.company or '(unknown company)'}", flush=True)


def _apply(args: argparse.Namespace) -> int:
    html, capture = _load_capture(args.output_dir)
    layout = LearnedJobListingLayout.model_validate_json(args.rules.read_text(encoding="utf-8"))
    _validate_layout(layout, html, capture)
    page_url = capture["url"]
    listings, next_urls, filters, searches = apply_listing_rules(
        html,
        page_url,
        f"{urlsplit(page_url).scheme}://{urlsplit(page_url).netloc}",
        layout.rules,
    )
    run = JobListingRun(
        page_url=page_url,
        layout_fingerprint=layout.layout_fingerprint,
        extraction_method="current_session_development_rules",
        listings=listings,
        next_page_urls=next_urls,
        filter_controls=filters,
        search_controls=searches,
        workflow=layout.workflow,
        learned_layout=layout,
        validation_errors=[] if listings else ["no job listings extracted"],
    )
    _render_outputs(
        args.output_dir,
        html,
        layout,
        run,
        source_label="Current Codex session — development-only live DOM rules",
        cdp_url=args.cdp_url,
    )
    return 0 if listings else 3


def _api_plan(args: argparse.Namespace) -> int:
    html, capture = _load_capture(args.output_dir)
    country_policy = _country_selection_policy(args)
    layout_store = JobListingLayoutStore(args.output_dir / "rules")
    artifact_store = JobScrapeArtifactStore(args.output_dir / "runs")
    planner = JobListingPlanner(
        get_configured_provider(),
        store=layout_store,
        artifact_store=artifact_store,
    )
    run = planner.plan_page(
        capture["url"],
        html,
        user_preferences="\n".join(
            part
            for part in (
                f"required work mode: {args.work_mode}"
                if args.work_mode != "any"
                else "",
                country_policy.planner_constraint() if country_policy else "",
                args.preferences,
            )
            if part
        ),
        force_relearn=args.force_relearn,
    )
    layout = run.learned_layout or layout_store.get(run.layout_fingerprint)
    if layout is None:
        raise SystemExit("The API run returned no executable layout.")
    _render_outputs(
        args.output_dir,
        html,
        layout,
        run,
        source_label="Configured model API — live DOM rules",
        cdp_url=args.cdp_url,
    )
    return 0 if not run.validation_errors else 3


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inventory", "apply", "api-plan"))
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--url", default="")
    parser.add_argument("--page-index", type=int, default=0)
    parser.add_argument("--timeout-ms", type=int, default=45_000)
    parser.add_argument("--settle-ms", type=int, default=2_000)
    parser.add_argument("--rules", type=Path, default=DEFAULT_OUTPUT / "rules.json")
    parser.add_argument("--preferences", default="")
    parser.add_argument(
        "--work-mode",
        choices=("remote", "hybrid", "onsite", "any"),
        default="any",
        help="Explicit user work-mode preference supplied to model planning.",
    )
    parser.add_argument(
        "--foreign-only",
        action="store_true",
        help="Optionally exclude the home country from the selected country list.",
    )
    parser.add_argument(
        "--home-country",
        default="",
        help="Home country excluded by --foreign-only.",
    )
    parser.add_argument(
        "--home-country-alias",
        action="append",
        default=[],
        help="Additional home-country name/code to exclude; may be repeated.",
    )
    parser.add_argument(
        "--target-country",
        action="append",
        default=[],
        help="Human-approved target country; may be repeated.",
    )
    parser.add_argument("--force-relearn", action="store_true")
    return parser


def main() -> int:
    args = _parser().parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.command == "inventory":
        return _capture(args)
    if args.command == "apply":
        return _apply(args)
    return _api_plan(args)


if __name__ == "__main__":
    raise SystemExit(main())
