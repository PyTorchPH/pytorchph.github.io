from __future__ import annotations

import json
import subprocess
import sys
from typing import Any

from prefect.automations import Automation
from prefect.blocks.core import Block
from prefect.events.actions import RunDeployment
from prefect.events.schemas.automations import EventTrigger
from prefect.exceptions import ObjectNotFound
from prefect.variables import Variable

from .flows import FLOW_REGISTRY
from .settings import REPO_ROOT, LabSettings

WORK_POOL = "pytorch-ph-local-process"
DIAGNOSTIC_DEPLOYMENT = "api-contracts"
VARIABLES: dict[str, Any] = {
    "pytorch_ph_default_workflow": "member-experience",
    "pytorch_ph_default_execution_mode": "sandbox",
    "pytorch_ph_artifact_retention_runs": 50,
    "pytorch_ph_scraper_max_pages": 5,
    "pytorch_ph_live_readonly_enabled": False,
}
GLOBAL_LIMITS = {
    "pytorch-ph-browser-cdp": 1,
    "pytorch-ph-live-scraper": 1,
    "pytorch-ph-model-planning": 1,
    "pytorch-ph-artifact-build": 1,
    "pytorch-ph-api-read": 4,
}
QUEUES = {
    "interactive": {"priority": 1, "limit": 1},
    "pipeline": {"priority": 2, "limit": 1},
    "diagnostics": {"priority": 3, "limit": 1},
}
DEPLOYMENT_QUEUES = {
    "member-experience": "interactive",
    "account-membership": "interactive",
    "career-opportunities": "interactive",
    "events-community": "interactive",
    "privacy-feedback": "interactive",
    "browser-lifecycle": "interactive",
    "api-contracts": "diagnostics",
    "scraper-economy": "pipeline",
    "evidence-compilation": "pipeline",
    "resume-build": "pipeline",
    "end-to-end": "pipeline",
}


class ProcessLabServices(Block):
    """Non-secret local service endpoints rendered by Prefect's native Blocks UI."""

    _block_type_name = "PyTorch PH Local Services"
    member_url: str
    officer_url: str
    api_url: str
    prefect_url: str
    cdp_url: str


class ProcessLabSafetyPolicy(Block):
    """Reviewable local policy; it never grants credentials or write authority."""

    _block_type_name = "PyTorch PH Safety Policy"
    default_mode: str = "sandbox"
    live_readonly_enabled: bool = False
    account_creation: bool = False
    event_registration: bool = False
    feedback_delivery: bool = False
    evidence_approval: bool = False
    points_award: bool = False
    upload_or_submit: bool = False


def _prefect(*args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "prefect", *args],
        check=True,
        text=True,
        capture_output=capture,
    )


def _configure_variables() -> list[str]:
    for name, value in VARIABLES.items():
        Variable.set(name, value, tags=["pytorch-ph", "process-lab"], overwrite=True)
    return sorted(VARIABLES)


def _configure_blocks(settings: LabSettings) -> list[str]:
    ProcessLabServices.register_type_and_schema()
    ProcessLabSafetyPolicy.register_type_and_schema()
    ProcessLabServices(
        member_url=settings.member_url,
        officer_url=settings.officer_url,
        api_url=settings.api_url,
        prefect_url="http://127.0.0.1:4200",
        cdp_url=settings.cdp_url,
    ).save("pytorch-ph-local-services", overwrite=True)
    ProcessLabSafetyPolicy().save("pytorch-ph-safety-policy", overwrite=True)
    return ["pytorch-ph-local-services", "pytorch-ph-safety-policy"]


def _configure_global_limits() -> list[str]:
    current = json.loads(
        _prefect("global-concurrency-limit", "ls", "--output", "json", capture=True).stdout or "[]"
    )
    existing = {item["name"] for item in current}
    for name, limit in GLOBAL_LIMITS.items():
        if name in existing:
            _prefect(
                "global-concurrency-limit",
                "update",
                name,
                "--limit",
                str(limit),
                "--enable",
            )
        else:
            _prefect("global-concurrency-limit", "create", name, "--limit", str(limit))
    return sorted(GLOBAL_LIMITS)


def _configure_work_pool() -> list[str]:
    _prefect("work-pool", "create", WORK_POOL, "--type", "process", "--overwrite")
    _prefect("work-pool", "set-concurrency-limit", WORK_POOL, "2")
    current = json.loads(
        _prefect("work-queue", "ls", "--pool", WORK_POOL, "--output", "json", capture=True).stdout
        or "[]"
    )
    existing = {item["name"] for item in current}
    for name, values in QUEUES.items():
        if name not in existing:
            _prefect(
                "work-queue",
                "create",
                name,
                "--pool",
                WORK_POOL,
                "--priority",
                str(values["priority"]),
                "--limit",
                str(values["limit"]),
            )
        else:
            _prefect(
                "work-queue",
                "set-concurrency-limit",
                name,
                str(values["limit"]),
                "--pool",
                WORK_POOL,
            )
    return list(QUEUES)


def _configure_deployments() -> dict[str, str]:
    identifiers: dict[str, str] = {}
    for name, queue in DEPLOYMENT_QUEUES.items():
        deployment = FLOW_REGISTRY[name].to_deployment(
            name=name,
            work_pool_name=WORK_POOL,
            work_queue_name=queue,
            job_variables={"working_dir": str(REPO_ROOT)},
            concurrency_limit=1,
            tags=["pytorch-ph", "process-lab", f"queue:{queue}"],
            description=f"Local-only PyTorch PH Process Lab deployment: {name}.",
        )
        identifiers[name] = str(deployment.apply())
    return identifiers


def _configure_automations(deployments: dict[str, str]) -> list[str]:
    diagnostic_id = deployments[DIAGNOSTIC_DEPLOYMENT]
    names: list[str] = []
    for deployment_name, deployment_id in deployments.items():
        if deployment_name == DIAGNOSTIC_DEPLOYMENT:
            continue
        name = f"PyTorch PH diagnose failed {deployment_name}"
        automation = Automation(
            name=name,
            description="Run local API diagnostics after this Process Lab deployment fails.",
            enabled=True,
            tags=["pytorch-ph", "process-lab", "local-diagnostics"],
            trigger=EventTrigger(
                match_related={"prefect.resource.id": f"prefect.deployment.{deployment_id}"},
                expect={
                    "prefect.flow-run.Failed",
                    "prefect.flow-run.Crashed",
                    "prefect.flow-run.TimedOut",
                },
                threshold=1,
                within=0,
            ),
            actions=[RunDeployment(deployment_id=diagnostic_id)],
        )
        try:
            existing = Automation.read(name=name)
        except (ObjectNotFound, ValueError):
            automation.create()
        else:
            automation.id = existing.id
            automation.update()
        names.append(name)
    return names


def configure_workspace() -> dict[str, Any]:
    """Create or update only Process Lab-owned Prefect resources."""
    settings = LabSettings.from_env()
    settings.ensure_local_dirs()
    report = {
        "variables": _configure_variables(),
        "blocks": _configure_blocks(settings),
        "global_concurrency_limits": _configure_global_limits(),
        "work_queues": _configure_work_pool(),
    }
    deployments = _configure_deployments()
    report["deployments"] = deployments
    report["automations"] = _configure_automations(deployments)
    report["work_pool"] = WORK_POOL
    return report
