from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

import requests

from .settings import REPO_ROOT, LabSettings


def prerequisites() -> dict[str, str | None]:
    docker = shutil.which("docker")
    docker_daemon: str | None = None
    if docker:
        try:
            probe = subprocess.run(
                [docker, "info", "--format", "{{.ServerVersion}}"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            if probe.returncode == 0:
                docker_daemon = probe.stdout.strip() or "ready"
        except (OSError, subprocess.TimeoutExpired):
            pass
    npm = shutil.which("npm")
    prefect = shutil.which("prefect")
    venv_prefect = os.path.join(os.path.dirname(sys.executable), "prefect")
    if prefect is None and os.path.isfile(venv_prefect):
        prefect = venv_prefect
    return {
        "docker": docker,
        "docker_daemon": docker_daemon,
        "npm": npm,
        "prefect": prefect,
    }


def require_prerequisites() -> None:
    missing = [name for name, path in prerequisites().items() if path is None]
    if missing:
        raise RuntimeError(
            "Missing Process Lab prerequisites: "
            + ", ".join(missing)
            + ". Install them before starting the local lab."
        )


def require_demo_prerequisites() -> None:
    values = prerequisites()
    missing = [name for name in ("npm", "prefect") if values[name] is None]
    if missing:
        raise RuntimeError(
            "Missing beginner demo prerequisites: "
            + ", ".join(missing)
            + ". Install them before starting the local lab."
        )


def _base_environment() -> dict[str, str]:
    var_root = Path(os.getenv("PYTORCH_PH_VAR_ROOT", REPO_ROOT / "var")).resolve()
    prefect_home = var_root / "state" / "process-lab" / "prefect"
    prefect_home.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment.update(
        {
            "PYTHONPATH": str(REPO_ROOT / "legacy" / "python"),
            "PYTORCH_PH_VAR_ROOT": str(var_root),
            "PYTORCH_PH_ARTIFACT_ROOT": str(
                Path(os.getenv("PYTORCH_PH_ARTIFACT_ROOT", REPO_ROOT / "out")).resolve()
            ),
            "PREFECT_API_URL": "http://127.0.0.1:4200/api",
            "PREFECT_HOME": str(prefect_home),
            "PREFECT_UI_STATIC_DIRECTORY": str(
                var_root / "cache" / "process-lab" / "prefect-ui"
            ),
            "PREFECT_SERVER_UI_V2_ENABLED": "true",
        }
    )
    # In-process Prefect SDK calls and child Prefect CLI calls must target the same
    # dedicated local server as the worker, not Prefect's temporary-server fallback.
    os.environ["PREFECT_API_URL"] = environment["PREFECT_API_URL"]
    os.environ["PREFECT_HOME"] = environment["PREFECT_HOME"]
    return environment


def _run_managed_stack(environment: dict[str, str], *, start_worker: bool) -> int:
    settings = LabSettings.from_env()
    settings.ensure_local_dirs()
    npm = shutil.which("npm")
    if npm is None:
        raise RuntimeError("npm is required to build the pinned local Prefect dashboard.")
    subprocess.run(
        ["node", "development/prefect-dashboard/build-dashboard.mjs"],
        cwd=REPO_ROOT,
        env=environment,
        check=True,
    )
    processes = [
        subprocess.Popen(
            [sys.executable, "scripts/dev_frontend.py"], cwd=REPO_ROOT, env=environment
        ),
        subprocess.Popen(
            [sys.executable, "-m", "prefect", "server", "start", "--host", "127.0.0.1"],
            cwd=REPO_ROOT,
            env=environment,
        ),
    ]

    def stop(*_args: object) -> None:
        for process in processes:
            if process.poll() is None:
                process.terminate()

    signal.signal(signal.SIGINT, stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, stop)
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            try:
                product_ready = requests.get(f"{settings.api_url}/healthz", timeout=1).ok
                prefect_ready = requests.get("http://127.0.0.1:4200/api/health", timeout=1).ok
                if product_ready and prefect_ready:
                    break
            except requests.RequestException:
                pass
            time.sleep(0.25)
        else:
            raise RuntimeError(
                "Local product or Prefect did not become ready within 60 seconds."
            )
        from .configuration import WORK_POOL, configure_workspace

        configure_workspace()
        from .flows import member_experience_flow

        state = member_experience_flow(return_state=True)
        run_id = state.state_details.flow_run_id
        if not run_id:
            raise RuntimeError("Prefect did not return the beginner flow-run ID.")
        if start_worker:
            processes.append(
                subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "prefect",
                        "worker",
                        "start",
                        "--pool",
                        WORK_POOL,
                        "--limit",
                        "2",
                        "--name",
                        "pytorch-ph-local-worker",
                        "--install-policy",
                        "never",
                    ],
                    cwd=REPO_ROOT,
                    env=environment,
                )
            )
        webbrowser.open(f"http://127.0.0.1:4200/runs/flow-run/{run_id}?tour=1")
        return max(process.wait() for process in processes)
    finally:
        stop()


def run_local_stack() -> int:
    require_prerequisites()
    environment = _base_environment()
    environment.update(
        {
            # Product data is the local store; accounts and reviewed records live in the Rust API.
            "PYTORCH_PH_DATA_PROVIDER": "local",
            "PYTORCH_PH_DEV_ACCESS": "0",
            "PYTORCH_PH_MEMBER_URL": "http://members.ph.localhost:3100",
            "PYTORCH_PH_OFFICER_URL": "http://officers.ph.localhost:3100",
        }
    )
    return _run_managed_stack(environment, start_worker=True)


def run_demo_stack() -> int:
    """Start the beginner-safe stack with synthetic data and no Docker dependency."""
    require_demo_prerequisites()
    environment = _base_environment()
    environment.update(
        {
            "PYTORCH_PH_DATA_PROVIDER": "local",
            "PYTORCH_PH_DEV_ACCESS": "1",
            "PYTORCH_PH_NO_BROWSER": "1",
            "PYTORCH_PH_MEMBER_URL": "http://members.ph.localhost:3100",
            "PYTORCH_PH_OFFICER_URL": "http://officers.ph.localhost:3100",
        }
    )
    return _run_managed_stack(environment, start_worker=False)
