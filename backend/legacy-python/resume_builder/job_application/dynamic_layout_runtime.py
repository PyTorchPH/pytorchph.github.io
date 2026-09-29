"""Capture, plan, validate, and cache unknown application layouts."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from resume_builder.extraction.crawler_dom import fingerprint
from resume_builder.job_finder.visualizer import sanitize_debug_dom
from resume_builder.llm.local_config import get_configured_provider, local_ai_status

from .models import DynamicApplicationPlan
from .visualizer import render_application_overlay
from .website_planner import ApplicationWebsitePlanner, build_application_dom_inventory


def dynamic_planner_status() -> dict[str, object]:
    """Expose model readiness without exposing API keys or endpoint credentials."""
    status = local_ai_status()
    ready = bool(status["configured"])
    return {
        "provider": status["provider"],
        "ready": ready,
        "status": "ready" if ready else "setup required",
    }


class DynamicApplicationRuleStore:
    """Strict subdomain + rendered-layout cache for accepted plans."""

    def __init__(self, root: Path) -> None:
        self.root = root

    @staticmethod
    def _host(value: str) -> str:
        host = (urlsplit(value).hostname or value).casefold()
        return re.sub(r"[^a-z0-9.-]+", "-", host).strip(".-") or "unknown"

    def path(self, host: str, layout_fingerprint: str) -> Path:
        return self.root / self._host(host) / f"{layout_fingerprint}.json"

    def get(self, host: str, layout_fingerprint: str) -> DynamicApplicationPlan | None:
        path = self.path(host, layout_fingerprint)
        if not path.is_file():
            return None
        try:
            plan = DynamicApplicationPlan.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not any(
            sample.subdomain.casefold() == self._host(host)
            and sample.layout_fingerprint == layout_fingerprint
            for sample in plan.samples
        ):
            return None
        return plan

    def put(self, host: str, layout_fingerprint: str, plan: DynamicApplicationPlan) -> Path:
        path = self.path(host, layout_fingerprint)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(plan.model_dump_json(indent=2), encoding="utf-8")
        temporary.replace(path)
        return path


def capture_unknown_application_layout(
    page,
    *,
    output_dir: Path,
    cache_dir: Path,
) -> dict[str, object]:
    """Persist sanitized evidence and optionally create a validated API plan."""
    safe_html = sanitize_debug_dom(page.content())
    layout_fingerprint = fingerprint(safe_html)
    host = (urlsplit(str(page.url)).hostname or "").casefold()
    safe_url = f"{urlsplit(str(page.url)).scheme}://{host}{urlsplit(str(page.url)).path}"
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "source.html").write_text(safe_html, encoding="utf-8")
    (output_dir / "inventory.txt").write_text(
        build_application_dom_inventory(safe_html, safe_url),
        encoding="utf-8",
    )
    capture = {
        "url": safe_url,
        "subdomain": host,
        "layout_fingerprint": layout_fingerprint,
    }
    (output_dir / "capture.json").write_text(json.dumps(capture, indent=2), encoding="utf-8")

    store = DynamicApplicationRuleStore(cache_dir)
    cached = store.get(host, layout_fingerprint)
    if cached is not None:
        return {**capture, "status": "cached_plan_ready", "plan": cached}

    readiness = dynamic_planner_status()
    if not readiness["ready"]:
        return {**capture, "status": "model_not_configured", "plan": None}
    try:
        plan = ApplicationWebsitePlanner(get_configured_provider()).plan(
            [(safe_url, safe_html)],
            objective="classify and fill this application draft without submitting",
        )
        if plan.confidence < 0.7:
            raise ValueError("planner confidence is below 0.70")
        for step in plan.interaction_steps:
            locator = page.locator(step.selector)
            if locator.count() == 0:
                raise ValueError(f"planned selector does not match the rendered page: {step.selector}")
        store.put(host, layout_fingerprint, plan)
        (output_dir / "rules.json").write_text(plan.model_dump_json(indent=2), encoding="utf-8")
        (output_dir / "annotated.html").write_text(
            render_application_overlay(safe_html, plan), encoding="utf-8"
        )
        return {**capture, "status": "plan_ready_for_review", "plan": plan}
    except Exception as exc:  # model/network/schema failures remain a human-visible handoff
        return {
            **capture,
            "status": "planning_failed",
            "warning": type(exc).__name__,
            "plan": None,
        }
