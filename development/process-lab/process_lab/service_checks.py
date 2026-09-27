from __future__ import annotations

import json
import os
import shutil
import subprocess
import sysconfig
from pathlib import Path
from typing import Any

import requests

from .contracts import ServiceCheckResult

PRIVATE_KEYS = {
    "access_token",
    "authorization",
    "cookie",
    "email",
    "password",
    "phone",
    "refresh_token",
    "session",
    "storage_state",
    "token",
}


def sanitized(value: Any) -> Any:
    """Remove secrets and direct contact data before Prefect receives a result."""
    if isinstance(value, dict):
        return {
            str(key): "[redacted]" if str(key).lower() in PRIVATE_KEYS else sanitized(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitized(item) for item in value]
    if isinstance(value, tuple):
        return [sanitized(item) for item in value]
    return value


def check_endpoint(name: str, url: str, timeout: float = 10.0) -> ServiceCheckResult:
    try:
        response = requests.get(url, timeout=timeout)
        return ServiceCheckResult(
            name=name,
            ok=response.ok,
            status_code=response.status_code,
            detail=response.reason,
        )
    except requests.RequestException as exc:
        return ServiceCheckResult(name=name, ok=False, detail=str(exc))


def fetch_openapi(api_url: str, output_path: Path) -> ServiceCheckResult:
    try:
        response = requests.get(f"{api_url.rstrip('/')}/openapi.json", timeout=15)
        response.raise_for_status()
        payload = sanitized(response.json())
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return ServiceCheckResult(
            name="fastapi-openapi",
            ok=True,
            status_code=response.status_code,
            detail=f"{len(payload.get('paths', {}))} documented paths",
            artifact=str(output_path),
        )
    except (requests.RequestException, ValueError) as exc:
        return ServiceCheckResult(name="fastapi-openapi", ok=False, detail=str(exc))


def run_schemathesis(api_url: str, output_path: Path) -> ServiceCheckResult:
    """Exercise the real OpenAPI surface with Schemathesis's maintained CLI."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    script_name = "schemathesis.exe" if os.name == "nt" else "schemathesis"
    installed_script = Path(sysconfig.get_path("scripts")) / script_name
    executable = shutil.which("schemathesis") or str(installed_script)
    command = [
        executable,
        "run",
        f"{api_url.rstrip('/')}/openapi.json",
        "--include-method",
        "GET",
        "--exclude-path-regex",
        "^/(auth|api/social-login)/",
        "--checks",
        "not_a_server_error",
        "--max-examples",
        "3",
        "--generation-deterministic",
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=180, check=False)
    report = f"$ {' '.join(command)}\n\n{completed.stdout}\n{completed.stderr}"
    output_path.write_text(report, encoding="utf-8")
    return ServiceCheckResult(
        name="schemathesis-openapi",
        ok=completed.returncode == 0,
        status_code=completed.returncode,
        detail="OpenAPI property checks passed" if completed.returncode == 0 else "See report",
        artifact=str(output_path),
    )
