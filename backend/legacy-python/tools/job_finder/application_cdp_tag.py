"""Inventory and visualize an application page without filling or submitting it."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = next(path for path in Path(__file__).resolve().parents if (path / "pyproject.toml").exists())
sys.path.insert(0, str(ROOT / "legacy" / "python"))

from resume_builder.extraction.crawler_dom import fingerprint  # noqa: E402
from resume_builder.job_application import (  # noqa: E402
    DynamicApplicationPlan,
    build_application_dom_inventory,
    render_application_overlay,
)
from resume_builder.job_finder import AccessGuard, sanitize_debug_dom  # noqa: E402

DEFAULT_OUTPUT = ROOT / "out" / "live-indeed-application"


def _write(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def inventory(args: argparse.Namespace) -> int:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(args.cdp_url)
        pages = [page for context in browser.contexts for page in context.pages]
        candidates = [page for page in pages if args.domain in urlsplit(page.url).netloc]
        if not candidates:
            print(f"STOP: no open page matches {args.domain}")
            return 2
        page = candidates[-1]
        raw = page.content()
        decision = AccessGuard().classify(url=page.url, html=raw)
        metadata = {
            "url": page.url,
            "title": page.title(),
            "access_state": decision.state.value,
            "should_continue": decision.should_continue,
            "reason": decision.reason,
        }
        _write(args.output_dir / "access.json", json.dumps(metadata, indent=2))
        try:
            page.screenshot(
                path=str(args.output_dir / "access.png"),
                full_page=False,
                timeout=5_000,
            )
        except Exception as exc:
            metadata["screenshot_warning"] = f"optional debug screenshot failed: {type(exc).__name__}"
            _write(args.output_dir / "access.json", json.dumps(metadata, indent=2))
        print(json.dumps(metadata, indent=2))
        if not decision.should_continue:
            print("STOP: human handoff required; no model inventory was accepted")
            return 2
        sanitized = sanitize_debug_dom(raw)
        _write(args.output_dir / "source.html", sanitized)
        _write(
            args.output_dir / "inventory.txt",
            build_application_dom_inventory(sanitized, page.url),
        )
        _write(
            args.output_dir / "capture.json",
            json.dumps({**metadata, "layout_fingerprint": fingerprint(sanitized)}, indent=2),
        )
        print(f"inventory: {args.output_dir / 'inventory.txt'}")
    return 0


def apply(args: argparse.Namespace) -> int:
    capture = json.loads((args.output_dir / "capture.json").read_text(encoding="utf-8"))
    html = (args.output_dir / "source.html").read_text(encoding="utf-8")
    plan = DynamicApplicationPlan.model_validate_json(args.rules.read_text(encoding="utf-8"))
    if capture.get("should_continue") is not True:
        raise SystemExit("Captured access state is not approved for visualization.")
    actual = fingerprint(html)
    if not any(
        sample.layout_fingerprint == actual
        and urlsplit(sample.url).netloc == urlsplit(capture["url"]).netloc
        for sample in plan.samples
    ):
        raise SystemExit("Plan has no sample matching the captured subdomain + layout fingerprint.")
    overlay = render_application_overlay(html, plan)
    _write(args.output_dir / "annotated.html", overlay)
    _write(args.output_dir / "plan.accepted.json", plan.model_dump_json(indent=2))

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(args.cdp_url)
        preview = browser.contexts[0].new_page()
        try:
            preview.set_content(overlay, wait_until="load")
            preview.screenshot(path=str(args.output_dir / "annotated.png"), full_page=True)
        finally:
            preview.close()
    print(f"annotated HTML: {args.output_dir / 'annotated.html'}")
    print(f"annotated screenshot: {args.output_dir / 'annotated.png'}")
    print(f"rules: {len(plan.dom_rules)}; interactions: {len(plan.interaction_steps)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inventory", "apply"))
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    parser.add_argument("--domain", default="smartapply.indeed.com")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--rules", type=Path, default=DEFAULT_OUTPUT / "rules.json")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    return inventory(args) if args.command == "inventory" else apply(args)


if __name__ == "__main__":
    raise SystemExit(main())
