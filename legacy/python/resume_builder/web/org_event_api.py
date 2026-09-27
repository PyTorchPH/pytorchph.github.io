"""Local-only external-event extraction and JSON validation API."""

from __future__ import annotations

import hashlib
import ipaddress
import socket
import time
import uuid
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from ..llm.local_config import get_configured_provider, local_ai_status

router = APIRouter(prefix="/api/org-events", tags=["org-events"])


class EventUrlRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class PipelineNodeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    node_id: str = Field(alias="nodeId", min_length=1, max_length=80)
    input: dict[str, object] = Field(default_factory=dict)


class ExternalEventPackage(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    title: str = Field(min_length=3, max_length=200)
    organizer: str = Field(min_length=2, max_length=200)
    summary: str = Field(min_length=10, max_length=3000)
    category: Literal["events", "workshops", "hackathons", "competitive-programming"]
    scope: Literal["external"] = "external"
    start_at: str = Field(alias="startAt")
    end_at: str | None = Field(default=None, alias="endAt")
    timezone_name: str = Field(alias="timezone", max_length=80)
    venue: str = Field(max_length=300)
    registration_url: HttpUrl | None = Field(default=None, alias="registrationUrl")
    registration_deadline: str | None = Field(default=None, alias="registrationDeadline")
    fee: str = Field(default="Not stated", max_length=120)
    eligibility: list[str] = Field(default_factory=list, max_length=20)
    requirements: list[str] = Field(default_factory=list, max_length=30)
    source_url: HttpUrl = Field(alias="sourceUrl")
    scraped_at: str = Field(alias="scrapedAt")
    content_hash: str = Field(alias="contentHash", pattern=r"^sha256:[0-9a-f]{64}$")
    scraper_version: str = Field(alias="scraperVersion", max_length=80)
    confidence: float = Field(ge=0, le=1)
    warnings: list[str] = Field(default_factory=list, max_length=20)


class ExtractedFacts(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    title: str = Field(min_length=3, max_length=200)
    organizer: str = Field(min_length=2, max_length=200)
    summary: str = Field(min_length=10, max_length=3000)
    category: Literal["events", "workshops", "hackathons", "competitive-programming"]
    start_at: str = Field(alias="startAt")
    end_at: str | None = Field(default=None, alias="endAt")
    timezone_name: str = Field(alias="timezone", max_length=80)
    venue: str = Field(max_length=300)
    registration_url: HttpUrl | None = Field(default=None, alias="registrationUrl")
    registration_deadline: str | None = Field(default=None, alias="registrationDeadline")
    fee: str = Field(default="Not stated", max_length=120)
    eligibility: list[str] = Field(default_factory=list, max_length=20)
    requirements: list[str] = Field(default_factory=list, max_length=30)
    confidence: float = Field(ge=0, le=1)
    warnings: list[str] = Field(default_factory=list, max_length=20)


def _assert_public_url(raw: str) -> None:
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Only public HTTP(S) event URLs are supported.")
    for address in socket.getaddrinfo(parsed.hostname, None):
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise ValueError("Private, loopback, and local-network event URLs are blocked.")


def _visible_page_text(url: str) -> tuple[str, str]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("Playwright is required for the normal visible-browser access gate.") from exc
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False)
        page = browser.new_page()
        def guard_navigation(route):
            request = route.request
            parsed = urlparse(request.url)
            if parsed.scheme in {"http", "https"}:
                try:
                    _assert_public_url(request.url)
                except (ValueError, OSError):
                    route.abort("blockedbyclient")
                    return
            elif parsed.scheme not in {"about", "blob", "data"}:
                route.abort("blockedbyclient")
                return
            route.continue_()
        page.route("**/*", guard_navigation)
        response = page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_timeout(1200)
        final_url = page.url
        _assert_public_url(final_url)
        title = page.title()
        body = page.locator("body").inner_text(timeout=5_000)[:30_000]
        status = response.status if response else 0
        blocked = status in {401, 403, 429} or any(marker in f"{title}\n{body[:2000]}".lower() for marker in ("captcha", "cloudflare", "verify you are human", "sign in to continue", "access denied"))
        browser.close()
    if blocked:
        raise PermissionError("Access verification or login is required; complete it in a normal browser and retry without bypassing it.")
    if status >= 400 or len(body.strip()) < 80:
        raise RuntimeError(f"The event page could not be read safely (HTTP {status}).")
    return final_url, f"{title}\n{body}"


def _stage(stage_id: str, label: str, *, requires_ai: bool = False) -> dict[str, object]:
    return {
        "id": stage_id,
        "label": label,
        "status": "pending",
        "requiresAI": requires_ai,
        "durationMs": None,
        "input": None,
        "output": None,
        "error": None,
    }


def _run_stage(stage: dict[str, object], input_value: object, operation):
    started = time.perf_counter()
    stage["status"] = "running"
    stage["input"] = input_value
    try:
        value, visible_output = operation()
        stage["status"] = "completed"
        stage["output"] = visible_output
        return value
    except Exception as exc:
        stage["status"] = "failed"
        stage["error"] = str(exc)
        raise
    finally:
        stage["durationMs"] = round((time.perf_counter() - started) * 1000)


def execute_event_pipeline(raw_url: str) -> tuple[dict[str, object], int]:
    stages = [
        _stage("ai-config", "AI configuration", requires_ai=True),
        _stage("access-gate", "Public URL access gate"),
        _stage("render", "Visible browser inventory"),
        _stage("extract", "Structured AI extraction", requires_ai=True),
        _stage("schema", "Strict JSON schema"),
        _stage("review", "Human department review"),
        _stage("email-draft", "Email handoff JSON"),
        _stage("email-approval", "Email readiness gate"),
        _stage("email-send", "External email delivery"),
    ]
    response: dict[str, object] = {
        "runId": str(uuid.uuid4()),
        "status": "running",
        "stages": stages,
        "package": None,
    }
    try:
        provider = _run_stage(
            stages[0],
            {"requiredBy": ["resume-builder", "scraper", "upskill"]},
            lambda: (get_configured_provider(), local_ai_status()),
        )
        requested_url = str(raw_url)
        _run_stage(
            stages[1],
            {"url": requested_url},
            lambda: (_assert_public_url(requested_url), {"allowed": True, "url": requested_url}),
        )
        final_url, visible_text = _run_stage(
            stages[2],
            {"url": requested_url, "browser": "Playwright Chromium (visible)"},
            lambda: (
                _visible_page_text(requested_url),
                {"browser": "visible", "access": "clear"},
            ),
        )
        cleaned = "\n".join(line.strip() for line in visible_text.splitlines() if line.strip())[:24_000]
        stages[2]["output"] = {
            "browser": "visible",
            "access": "clear",
            "finalUrl": final_url,
            "renderedCharacters": len(cleaned),
            "textPreview": cleaned[:800],
            "renderedText": cleaned,
        }
        facts = _run_stage(
            stages[3],
            {"renderedCharacters": len(cleaned), "schema": "ExtractedFacts"},
            lambda: (
                provider.structured(
                    "Extract only facts explicitly present in this rendered external-event page. "
                    "Use ISO-8601 dates with timezone when present. Put missing or ambiguous facts in warnings; never invent them.\n\n"
                    + cleaned,
                    schema=ExtractedFacts,
                    system="You are an event-page extraction stage, not an approval or verification authority.",
                    max_tokens=2200,
                ),
                {
                    "provider": provider.name,
                    "contract": "ExtractedFacts",
                },
            ),
        )
        stages[3]["output"] = {
            **stages[3]["output"],
            "aiResponse": facts.model_dump(mode="json", by_alias=True),
        }
        digest = hashlib.sha256(cleaned.encode("utf-8")).hexdigest()
        package = _run_stage(
            stages[4],
            facts.model_dump(mode="json", by_alias=True),
            lambda: (
                ExternalEventPackage(
                    **facts.model_dump(by_alias=True), sourceUrl=final_url,
                    scrapedAt=datetime.now(UTC).isoformat(), contentHash=f"sha256:{digest}",
                    scraperVersion="local-visible-playwright-v1",
                ),
                {"valid": True, "contract": "ExternalEventPackage"},
            ),
        )
        stages[5]["status"] = "blocked"
        stages[5]["input"] = {"packageReady": True}
        stages[5]["output"] = {"reason": "Human approval is required outside this workbench."}
        for stage in stages[6:]:
            stage["status"] = "blocked"
            stage["error"] = "Department and email approvals are required before delivery."
        response["status"] = "awaiting_human_review"
        response["package"] = package.model_dump(mode="json", by_alias=True)
        return response, 200
    except PermissionError as exc:
        error_message = str(exc)
        status_code = 409
    except Exception as exc:  # bounded local API: report, never retry with disguise
        error_message = str(exc)
        status_code = 409 if not local_ai_status()["configured"] else 422
    failed_index = next(
        (index for index, stage in enumerate(stages) if stage["status"] == "failed"),
        len(stages) - 1,
    )
    for stage in stages[failed_index + 1 :]:
        stage["status"] = "blocked"
        stage["error"] = "Blocked by an earlier stage."
    response["status"] = "failed"
    response["error"] = error_message
    return response, status_code


def _email_handoff(package: ExternalEventPackage) -> dict[str, object]:
    subject = f"SADO endorsement request — {package.title}"
    body = (
        f"Organizer: {package.organizer}\nEvent: {package.title}\n"
        f"Schedule: {package.start_at} ({package.timezone_name})\n"
        f"Venue: {package.venue}\nSource: {package.source_url}\n\n{package.summary}"
    )
    return {
        "to": ["configured allowlisted recipient (hidden)"],
        "subject": subject,
        "body": body,
        "revisionHash": hashlib.sha256((subject + body).encode("utf-8")).hexdigest(),
        "deliveryMode": "dry_run",
        "deliveryStatus": "not_sent",
    }


def execute_pipeline_node(node_id: str, input_value: dict[str, object]) -> tuple[dict[str, object], int]:
    labels = {
        "ai-config": ("AI configuration", True),
        "access-gate": ("Public URL access gate", False),
        "render": ("Visible browser inventory", False),
        "extract": ("Structured AI extraction", True),
        "schema": ("Strict JSON schema", False),
        "review": ("Human department review", False),
        "email-draft": ("Email handoff JSON", False),
        "email-approval": ("Email readiness gate", False),
        "email-send": ("External email delivery", False),
    }
    if node_id not in labels:
        return {"error": f"Unknown pipeline node: {node_id}"}, 404
    label, requires_ai = labels[node_id]
    node = _stage(node_id, label, requires_ai=requires_ai)
    node["input"] = input_value
    try:
        if node_id == "ai-config":
            provider = get_configured_provider()
            output = {**local_ai_status(), "runtimeProvider": provider.name}
        elif node_id == "access-gate":
            get_configured_provider()
            url = str(input_value.get("url", ""))
            _assert_public_url(url)
            output = {"allowed": True, "url": url}
        elif node_id == "render":
            get_configured_provider()
            url = str(input_value.get("url", ""))
            _assert_public_url(url)
            final_url, text = _visible_page_text(url)
            cleaned = "\n".join(line.strip() for line in text.splitlines() if line.strip())[:24_000]
            output = {"finalUrl": final_url, "renderedCharacters": len(cleaned), "renderedText": cleaned}
        elif node_id == "extract":
            provider = get_configured_provider()
            rendered_text = str(input_value.get("renderedText", "")).strip()[:24_000]
            if len(rendered_text) < 80:
                raise ValueError("renderedText must contain at least 80 characters from a rendered page fixture.")
            facts = provider.structured(
                "Extract only facts explicitly present in this rendered external-event page. "
                "Use ISO-8601 dates with timezone when present; never invent missing facts.\n\n"
                + rendered_text,
                schema=ExtractedFacts,
                system="You are an event-page extraction stage, not an approval authority.",
                max_tokens=2200,
            )
            output = {"provider": provider.name, "aiResponse": facts.model_dump(mode="json", by_alias=True)}
        elif node_id == "schema":
            package = ExternalEventPackage.model_validate(input_value)
            output = {"valid": True, "normalized": package.model_dump(mode="json", by_alias=True)}
        elif node_id == "review":
            output = {"allowed": False, "reason": "Human department review cannot be simulated or approved here."}
            node["status"] = "blocked"
            return {"node": node | {"output": output}}, 200
        elif node_id == "email-draft":
            package = ExternalEventPackage.model_validate(input_value)
            output = _email_handoff(package)
        elif node_id == "email-approval":
            department_approved = input_value.get("departmentApproved") is True
            human_approved = input_value.get("humanApproved") is True
            output = {
                "ready": department_approved and human_approved,
                "checks": {
                    "departmentApproved": department_approved,
                    "humanApprovedExactRevision": human_approved,
                    "recipientAllowlistGatePresent": True,
                },
            }
        else:
            output = {"allowed": False, "reason": "The workbench is dry-run only; external email delivery is disabled."}
            node["status"] = "blocked"
            return {"node": node | {"output": output}}, 200
        node["status"] = "completed"
        node["output"] = output
        node["durationMs"] = 0
        return {"node": node}, 200
    except Exception as exc:
        node["status"] = "failed"
        node["error"] = str(exc)
        ai_gated = node_id in {"ai-config", "access-gate", "render", "extract"}
        status_code = 409 if ai_gated and not local_ai_status()["configured"] else 422
        return {"node": node, "error": str(exc)}, status_code


@router.post("/run")
def run_event_pipeline(request: EventUrlRequest):
    value, status_code = execute_event_pipeline(str(request.url))
    return JSONResponse(value, status_code=status_code)


@router.post("/run-node")
def run_event_pipeline_node(request: PipelineNodeRequest):
    value, status_code = execute_pipeline_node(request.node_id, request.input)
    return JSONResponse(value, status_code=status_code)


@router.post("/extract")
def extract_event(request: EventUrlRequest):
    value, status_code = execute_event_pipeline(str(request.url))
    if status_code == 200:
        return value["package"]
    return JSONResponse({"error": value.get("error"), "pipeline": value}, status_code=status_code)


@router.post("/validate")
def validate_event(payload: dict):
    try:
        value = ExternalEventPackage.model_validate(payload)
        return {"valid": True, "normalized": value.model_dump(mode="json", by_alias=True), "errors": []}
    except Exception as exc:
        return JSONResponse({"valid": False, "errors": [str(exc)]}, status_code=422)
