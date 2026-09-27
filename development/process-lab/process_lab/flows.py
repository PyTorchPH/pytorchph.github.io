from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from prefect import flow, task
from prefect.artifacts import create_markdown_artifact
from prefect.concurrency.sync import concurrency
from prefect.events import emit_event

from .browser import leaderboard_journey, login_journey, registration_contract_journey
from .service_checks import check_endpoint, fetch_openapi, run_schemathesis, sanitized
from .settings import REPO_ROOT, LabSettings

PRODUCT_SRC = str(REPO_ROOT / "legacy" / "python")
if PRODUCT_SRC not in sys.path:
    sys.path.insert(0, PRODUCT_SRC)


def _product_environment() -> dict[str, str]:
    environment = os.environ.copy()
    current = environment.get("PYTHONPATH", "")
    environment["PYTHONPATH"] = (
        PRODUCT_SRC if not current else f"{PRODUCT_SRC}{os.pathsep}{current}"
    )
    return environment


def _event_resource(kind: str, label: str) -> dict[str, str]:
    slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")[:80]
    return {
        "prefect.resource.id": f"pytorch-ph.{kind}.{slug}",
        "prefect.resource.name": label,
        "pytorch-ph.scope": "local-process-lab",
    }


def emit_lab_event(event: str, kind: str, label: str, payload: dict[str, Any]) -> None:
    """Emit bounded metadata only; callers must never include secrets or private records."""
    emit_event(event=event, resource=_event_resource(kind, label), payload=sanitized(payload))


@task(name="FastAPI health")
def fastapi_health(settings: LabSettings) -> dict[str, Any]:
    with concurrency("pytorch-ph-api-read", strict=True):
        result = check_endpoint("fastapi", f"{settings.api_url}/healthz").as_dict()
    emit_lab_event(
        "pytorch-ph.api.checked" if result["ok"] else "pytorch-ph.api.failed",
        "api",
        "FastAPI health",
        {"ok": result["ok"], "status_code": result["status_code"]},
    )
    return result


@task(name="OpenAPI contract")
def openapi_contract(settings: LabSettings) -> dict[str, Any]:
    with concurrency("pytorch-ph-api-read", strict=True):
        result = fetch_openapi(settings.api_url, settings.artifact_root / "openapi.json").as_dict()
    emit_lab_event(
        "pytorch-ph.artifact.created" if result["ok"] else "pytorch-ph.api.failed",
        "artifact",
        "OpenAPI contract",
        {"ok": result["ok"], "artifact": result["artifact"]},
    )
    return result


@task(name="Schemathesis API verification", retries=0)
def schemathesis_contract(settings: LabSettings) -> dict[str, Any]:
    return run_schemathesis(
        settings.api_url, settings.artifact_root / "schemathesis-report.txt"
    ).as_dict()


@flow(name="PyTorch PH API contracts", log_prints=True)
def api_contract_flow(run_property_checks: bool = False) -> dict[str, Any]:
    settings = LabSettings.from_env()
    settings.ensure_local_dirs()
    results = [fastapi_health(settings), openapi_contract(settings)]
    if run_property_checks:
        results.append(schemathesis_contract(settings))
    payload = {"checks": results, "ok": all(item["ok"] for item in results)}
    create_markdown_artifact(
        key="pytorch-ph-api-contracts",
        markdown="# API contract run\n\n```json\n" + json.dumps(payload, indent=2) + "\n```",
    )
    return payload


@task(name="Registration form contract")
def registration_contract(settings: LabSettings, run_id: str) -> dict[str, Any]:
    return registration_contract_journey(
        cdp_url=settings.cdp_url,
        member_url=settings.member_url,
        trace_path=settings.artifact_root / run_id / "registration-trace.zip",
    ).as_dict()


@task(name="Member login")
def member_login(settings: LabSettings, run_id: str) -> dict[str, Any]:
    return login_journey(
        cdp_url=settings.cdp_url,
        member_url=settings.member_url,
        email=os.getenv("PROCESS_LAB_EMAIL", ""),
        password=os.getenv("PROCESS_LAB_PASSWORD", ""),
        trace_path=settings.artifact_root / run_id / "login-trace.zip",
    ).as_dict()


@task(name="Leaderboard privacy and rendering")
def leaderboard_check(settings: LabSettings, run_id: str) -> dict[str, Any]:
    return leaderboard_journey(
        cdp_url=settings.cdp_url,
        member_url=settings.member_url,
        trace_path=settings.artifact_root / run_id / "leaderboard-trace.zip",
    ).as_dict()


@flow(name="PyTorch PH browser lifecycle", log_prints=True)
def browser_lifecycle_flow(include_login: bool = False) -> dict[str, Any]:
    settings = LabSettings.from_env()
    settings.ensure_local_dirs()
    run_id = f"browser-{int(time.time())}"
    results = [registration_contract(settings, run_id)]
    if include_login:
        results.append(member_login(settings, run_id))
        results.append(leaderboard_check(settings, run_id))
    payload = {"journeys": results, "ok": all(item["ok"] for item in results)}
    create_markdown_artifact(
        key="pytorch-ph-browser-lifecycle",
        markdown="# Browser lifecycle\n\n```json\n"
        + json.dumps(sanitized(payload), indent=2)
        + "\n```",
    )
    return payload


@task(name="Member process node", task_run_name="{label}")
def member_surface(
    settings: LabSettings,
    label: str,
    path: str,
    upstream: object | None = None,
) -> dict[str, Any]:
    """Observe a real member-facing route while retaining data dependencies for the DAG."""
    del upstream
    with concurrency("pytorch-ph-api-read", strict=True):
        result = check_endpoint(label, f"{settings.member_url}{path}").as_dict()
    payload = {**result, "path": path, "kind": "product_route"}
    emit_lab_event(
        "pytorch-ph.route.checked" if result["ok"] else "pytorch-ph.route.failed",
        "route",
        label,
        {"path": path, "ok": result["ok"], "status_code": result["status_code"]},
    )
    return payload


@task(name="Human-controlled gate", task_run_name="{label}")
def member_human_gate(label: str, reason: str, upstream: object) -> dict[str, Any]:
    """Render an explicit stop/approval node; the Process Lab never performs this write."""
    del upstream
    payload = {
        "name": label,
        "kind": "human_gate",
        "status": "blocked_by_design",
        "reason": reason,
        "writes_performed": False,
        "ok": True,
    }
    emit_lab_event(
        "pytorch-ph.human-gate.reached",
        "human-gate",
        label,
        {"status": payload["status"], "writes_performed": False},
    )
    return payload


@task(name="Member journey summary")
def member_journey_summary(branches: list[dict[str, Any]]) -> dict[str, Any]:
    route_nodes = [node for node in branches if node.get("kind") == "product_route"]
    gates = [node for node in branches if node.get("kind") == "human_gate"]
    return {
        "route_nodes": len(route_nodes),
        "reachable_routes": sum(bool(node.get("ok")) for node in route_nodes),
        "human_gates": [node["name"] for node in gates],
        "ok": all(bool(node.get("ok")) for node in branches),
    }


@flow(name="PyTorch PH major member experience", log_prints=True)
def member_experience_flow() -> dict[str, Any]:
    """n8n-style overview of the major journeys an ordinary member can take."""
    settings = LabSettings.from_env()
    settings.ensure_local_dirs()

    landing = member_surface(settings, "1 · Discover landing page", "/")
    registration = member_surface(settings, "2 · Review registration", "/register", landing)
    account_creation = member_human_gate(
        "3 · Submit account details",
        "Account creation requires the user's explicit form submission and verification.",
        registration,
    )
    login = member_surface(settings, "4 · Sign in", "/login", account_creation)
    membership = member_surface(settings, "5 · Verify membership access", "/membership", login)
    dashboard = member_surface(settings, "6 · Open personal dashboard", "/dashboard", membership)

    evidence = member_surface(
        settings, "7A · Review career evidence", "/career/evidence", dashboard
    )
    resumes = member_surface(settings, "8A · Build and review resume", "/career/resumes", evidence)
    opportunities = member_surface(
        settings, "9A · Discover opportunities", "/jobs/opportunities", resumes
    )
    application_gate = member_human_gate(
        "10A · Approve application action",
        "Resume selection, uploads, Continue, and final submission remain user-controlled.",
        opportunities,
    )

    events = member_surface(settings, "7B · Browse chapter events", "/events", dashboard)
    event_gate = member_human_gate(
        "8B · Confirm event interest or registration",
        "The member must approve any event interest or registration write.",
        events,
    )

    leaderboard = member_surface(
        settings, "7C · View private-safe leaderboard", "/leaderboards", dashboard
    )
    trust = member_surface(settings, "8C · Review privacy and trust", "/trust", leaderboard)

    profile = member_surface(
        settings, "7D · Review personal profile", "/dashboard/profile", dashboard
    )
    settings_page = member_surface(settings, "8D · Configure member settings", "/settings", profile)

    feedback_gate = member_human_gate(
        "9 · Confirm privacy-safe feedback",
        "A report is sent only after the member intentionally confirms the bounded diagnostic.",
        [application_gate, event_gate, trust, settings_page],
    )
    summary = member_journey_summary(
        [
            landing,
            registration,
            account_creation,
            login,
            membership,
            dashboard,
            evidence,
            resumes,
            opportunities,
            application_gate,
            events,
            event_gate,
            leaderboard,
            trust,
            profile,
            settings_page,
            feedback_gate,
        ]
    )
    create_markdown_artifact(
        key="pytorch-ph-major-member-experience",
        markdown=(
            "# Major member experience DAG\n\n"
            "The run graph is the visual source of truth. It follows real product routes and "
            "shows explicit human-controlled gates for writes.\n\n```json\n"
            + json.dumps(summary, indent=2)
            + "\n```"
        ),
    )
    return summary


@flow(name="PyTorch PH account and membership", log_prints=True)
def account_membership_flow() -> dict[str, Any]:
    settings = LabSettings.from_env()
    landing = member_surface(settings, "Discover landing page", "/")
    registration = member_surface(settings, "Review registration", "/register", landing)
    submit_gate = member_human_gate(
        "Submit account details",
        "Account creation and verification require the user's explicit action.",
        registration,
    )
    login = member_surface(settings, "Sign in", "/login", submit_gate)
    membership = member_surface(settings, "Verify membership access", "/membership", login)
    dashboard = member_surface(settings, "Open personal dashboard", "/dashboard", membership)
    return member_journey_summary(
        [landing, registration, submit_gate, login, membership, dashboard]
    )


@flow(name="PyTorch PH career and opportunities", log_prints=True)
def career_opportunities_flow() -> dict[str, Any]:
    settings = LabSettings.from_env()
    dashboard = member_surface(settings, "Open personal dashboard", "/dashboard")
    evidence = member_surface(settings, "Review career evidence", "/career/evidence", dashboard)
    resumes = member_surface(settings, "Build and review resume", "/career/resumes", evidence)
    opportunities = member_surface(
        settings, "Discover opportunities", "/jobs/opportunities", resumes
    )
    gate = member_human_gate(
        "Approve application action",
        "Uploads, Continue, and final submission remain user-controlled.",
        opportunities,
    )
    return member_journey_summary([dashboard, evidence, resumes, opportunities, gate])


@flow(name="PyTorch PH events and community", log_prints=True)
def events_community_flow() -> dict[str, Any]:
    settings = LabSettings.from_env()
    dashboard = member_surface(settings, "Open personal dashboard", "/dashboard")
    events = member_surface(settings, "Browse chapter events", "/events", dashboard)
    gate = member_human_gate(
        "Confirm event interest or registration",
        "Event interest and registration writes require member approval.",
        events,
    )
    leaderboard = member_surface(
        settings, "View private-safe leaderboard", "/leaderboards", dashboard
    )
    return member_journey_summary([dashboard, events, gate, leaderboard])


@flow(name="PyTorch PH privacy profile and feedback", log_prints=True)
def privacy_feedback_flow() -> dict[str, Any]:
    settings = LabSettings.from_env()
    dashboard = member_surface(settings, "Open personal dashboard", "/dashboard")
    trust = member_surface(settings, "Review privacy and trust", "/trust", dashboard)
    profile = member_surface(settings, "Review personal profile", "/dashboard/profile", dashboard)
    settings_page = member_surface(settings, "Configure member settings", "/settings", profile)
    gate = member_human_gate(
        "Confirm privacy-safe feedback",
        "Feedback is sent only after the member confirms the bounded diagnostic.",
        [trust, settings_page],
    )
    return member_journey_summary([dashboard, trust, profile, settings_page, gate])


@task(name="Access-gated scraper CLI", timeout_seconds=240)
def scraper_cli(seed_url: str, output_dir: Path, max_pages: int) -> dict[str, Any]:
    command = [
        sys.executable,
        "-m",
        "resume_builder.cli",
        "crawl-site",
        seed_url,
        "--output-dir",
        str(output_dir),
        "--max-pages",
        str(max_pages),
        "--max-depth",
        "2",
        "--visible",
    ]
    with concurrency("pytorch-ph-live-scraper", strict=True):
        completed = subprocess.run(
            command,
            cwd=REPO_ROOT,
            env=_product_environment(),
            capture_output=True,
            text=True,
            timeout=240,
            check=False,
        )
    if completed.returncode:
        raise RuntimeError((completed.stderr or completed.stdout).strip())
    artifact = output_dir / "latest-run.json"
    return {"command": command, "artifact": str(artifact), "summary": completed.stdout.strip()}


@task(name="Deterministic scraper replay comparison")
def scraper_replay_summary(first_artifact: str, second_artifact: str) -> dict[str, Any]:
    first = json.loads(Path(first_artifact).read_text(encoding="utf-8"))
    second = json.loads(Path(second_artifact).read_text(encoding="utf-8"))
    first_layouts = {item["layout_fingerprint"] for item in first.get("learned_layouts", [])}
    second_layouts = {item["layout_fingerprint"] for item in second.get("learned_layouts", [])}
    payload = {
        "first_pages": len(first.get("visited_urls", [])),
        "second_pages": len(second.get("visited_urls", [])),
        "same_layouts": first_layouts == second_layouts,
        "replayed_layouts": sorted(second_layouts),
        "latest_artifact": second_artifact,
        "token_claim": "deterministic extraction uses zero model tokens; provider usage is reported separately",
    }
    emit_lab_event(
        "pytorch-ph.scraper.cache-compared",
        "scraper",
        "Deterministic replay",
        {"same_layouts": payload["same_layouts"], "second_pages": payload["second_pages"]},
    )
    return payload


@flow(name="PyTorch PH scraper cache and token economy", log_prints=True)
def scraper_economy_flow(seed_url: str, max_pages: int = 5) -> dict[str, Any]:
    settings = LabSettings.from_env()
    settings.ensure_local_dirs()
    output_dir = settings.artifact_root / f"scraper-{int(time.time())}"
    first = scraper_cli(seed_url, output_dir, max_pages)
    first_snapshot = output_dir / "first-run.json"
    first_snapshot.write_text(Path(first["artifact"]).read_text(encoding="utf-8"), encoding="utf-8")
    second = scraper_cli(seed_url, output_dir, max_pages)
    comparison = scraper_replay_summary(str(first_snapshot), second["artifact"])
    create_markdown_artifact(
        key="pytorch-ph-scraper-economy",
        markdown="# Scraper cache comparison\n\n```json\n"
        + json.dumps(comparison, indent=2)
        + "\n```",
    )
    return comparison


@task(name="Compile scraped career evidence", timeout_seconds=180)
def compile_evidence(crawl_artifact: str, output_path: Path) -> dict[str, Any]:
    """Call the production P3 interpreter; the lab only adapts the crawler artifact."""
    from resume_builder.extraction.models import CleanedSource
    from resume_builder.interpretation import interpret
    from resume_builder.llm.local_config import get_configured_provider

    payload = json.loads(Path(crawl_artifact).read_text(encoding="utf-8"))
    projects = [
        CleanedSource(
            source_id=str(page["url"]),
            kind="website",
            title=str(page["url"]),
            text=str(page.get("content", "")),
            degraded=page.get("extraction_method") != "ai_rules",
        )
        for page in payload.get("extracted_pages", [])
        if str(page.get("content", "")).strip()
    ]
    if not projects:
        raise ValueError("The crawl artifact contains no extracted evidence text.")
    provider = get_configured_provider()
    with concurrency("pytorch-ph-model-planning", strict=True):
        classification, report, profile = interpret(provider, projects=projects)
    result = {
        "classification": classification.model_dump(mode="json"),
        "report": {
            **report.model_dump(mode="json"),
            "success_rate": report.success_rate,
        },
        "profile": profile.model_dump(mode="json"),
        "source_ids": [project.source_id for project in projects],
        "model_usage": {
            **provider.usage_snapshot(),
            "measurement": "provider_reported",
        },
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    emit_lab_event(
        "pytorch-ph.artifact.created",
        "artifact",
        "Compiled career evidence",
        {"artifact": str(output_path), "source_count": len(projects)},
    )
    return {"artifact": str(output_path), **result}


@task(name="Leaderboard human-review gate")
def leaderboard_human_gate(evidence: dict[str, Any]) -> dict[str, Any]:
    projects = evidence.get("classification", {}).get("projects", [])
    return {
        "status": "blocked",
        "candidate_count": len(projects),
        "source_ids": evidence.get("source_ids", []),
        "reason": "An officer must review provenance before any points are awarded.",
        "writes_performed": False,
    }


@flow(name="PyTorch PH scraped evidence compilation", log_prints=True)
def evidence_compilation_flow(crawl_artifact: str) -> dict[str, Any]:
    settings = LabSettings.from_env()
    settings.ensure_local_dirs()
    compiled = compile_evidence(
        crawl_artifact,
        settings.artifact_root / f"evidence-{int(time.time())}" / "compiled-evidence.json",
    )
    gate = leaderboard_human_gate(compiled)
    create_markdown_artifact(
        key="pytorch-ph-evidence-compilation",
        markdown="# Evidence compilation\n\n"
        + f"Sources: {len(compiled['source_ids'])}\n\n"
        + f"Tag success rate: {compiled['report']['success_rate']:.1%}\n\n"
        + f"Leaderboard: **{gate['status']}** — {gate['reason']}",
    )
    return {"compiled": compiled, "leaderboard_gate": gate}


@task(name="Resume production CLI", timeout_seconds=300)
def resume_cli(gh_user: str, role: str, output_dir: Path) -> dict[str, Any]:
    command = [
        sys.executable,
        "-m",
        "resume_builder.cli",
        "build",
        "--mode",
        "static",
        "--gh-user",
        gh_user,
        "--role",
        role,
        "--formats",
        "html,md,json,pdf",
        "--output",
        str(output_dir),
    ]
    with concurrency("pytorch-ph-artifact-build", strict=True):
        completed = subprocess.run(
            command,
            cwd=REPO_ROOT,
            env=_product_environment(),
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
    if completed.returncode:
        raise RuntimeError((completed.stderr or completed.stdout).strip())
    artifacts = sorted(str(path) for path in output_dir.rglob("*") if path.is_file())
    emit_lab_event(
        "pytorch-ph.artifact.created",
        "artifact",
        "Resume build",
        {"artifact_count": len(artifacts), "output_dir": str(output_dir)},
    )
    return {"summary": completed.stdout.strip(), "artifacts": artifacts}


@flow(name="PyTorch PH evidence to resume", log_prints=True)
def resume_build_flow(gh_user: str, role: str) -> dict[str, Any]:
    settings = LabSettings.from_env()
    settings.ensure_local_dirs()
    output_dir = settings.artifact_root / f"resume-{int(time.time())}"
    result = resume_cli(gh_user, role, output_dir)
    create_markdown_artifact(
        key="pytorch-ph-resume-build",
        markdown="# Resume build artifacts\n\n"
        + "\n".join(f"- `{p}`" for p in result["artifacts"]),
    )
    return result


FLOW_REGISTRY = {
    "api-contracts": api_contract_flow,
    "browser-lifecycle": browser_lifecycle_flow,
    "member-experience": member_experience_flow,
    "account-membership": account_membership_flow,
    "career-opportunities": career_opportunities_flow,
    "events-community": events_community_flow,
    "privacy-feedback": privacy_feedback_flow,
    "scraper-economy": scraper_economy_flow,
    "evidence-compilation": evidence_compilation_flow,
    "resume-build": resume_build_flow,
}


@flow(name="PyTorch PH end-to-end career process", log_prints=True)
def end_to_end_flow(seed_url: str, gh_user: str, role: str) -> dict[str, Any]:
    scraper = scraper_economy_flow(seed_url=seed_url, max_pages=5)
    evidence = evidence_compilation_flow(crawl_artifact=scraper["latest_artifact"])
    return {
        "api": api_contract_flow(run_property_checks=False),
        "browser": browser_lifecycle_flow(include_login=False),
        "scraper": scraper,
        "evidence": evidence,
        "resume": resume_build_flow(gh_user=gh_user, role=role),
        "leaderboard_gate": evidence["leaderboard_gate"],
    }


FLOW_REGISTRY["end-to-end"] = end_to_end_flow
