from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
LAB_PACKAGE = ROOT / "development" / "process-lab" / "process_lab"


def load_lab_module(name: str):
    package_name = "process_lab"
    if package_name not in __import__("sys").modules:
        package_spec = importlib.util.spec_from_file_location(
            package_name,
            LAB_PACKAGE / "__init__.py",
            submodule_search_locations=[str(LAB_PACKAGE)],
        )
        package = importlib.util.module_from_spec(package_spec)
        __import__("sys").modules[package_name] = package
        assert package_spec.loader is not None
        package_spec.loader.exec_module(package)
    spec = importlib.util.spec_from_file_location(f"process_lab.{name}", LAB_PACKAGE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    __import__("sys").modules[spec.name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_process_lab_is_not_imported_by_product_sources():
    offenders = []
    for root in (
        ROOT / "legacy" / "python",
        ROOT / "apps" / "portal" / "app",
        ROOT / "domains",
    ):
        for path in root.rglob("*"):
            if path.suffix not in {".py", ".ts", ".tsx", ".mjs"}:
                continue
            content = path.read_text(encoding="utf-8", errors="replace")
            if "import process_lab" in content or "from process_lab" in content:
                offenders.append(str(path.relative_to(ROOT)))
    assert offenders == []


def test_product_web_has_no_test_session_or_developer_named_capability_route():
    web_root = ROOT / "apps" / "portal"
    assert not (web_root / "app" / "api" / "dev-session" / "route.ts").exists()
    assert not (web_root / "app" / "api" / "dev-capabilities" / "route.ts").exists()
    product_text = "\n".join(
        path.read_text(encoding="utf-8", errors="replace")
        for base in (web_root / "app", ROOT / "domains", ROOT / "design-system")
        for path in base.rglob("*")
        if path.suffix in {".ts", ".tsx"}
    )
    assert "PYTORCH_PH_DEV_BYPASS_SIGN_IN" not in product_text
    assert "pytorch_ph_dev_session" not in product_text


def test_process_lab_sanitizer_redacts_nested_secrets():
    service_checks = load_lab_module("service_checks")
    value = service_checks.sanitized(
        {"token": "secret", "nested": [{"email": "member@fit.edu.ph", "safe": 2}]}
    )
    assert value == {"token": "[redacted]", "nested": [{"email": "[redacted]", "safe": 2}]}


def test_artifact_guard_rejects_lab_and_trace_files(tmp_path):
    guard = load_lab_module("artifact_guard")
    (tmp_path / "server.js").write_text("production", encoding="utf-8")
    assert guard.forbidden_artifacts(tmp_path) == []
    (tmp_path / "browser-trace.zip").write_text("trace", encoding="utf-8")
    assert guard.forbidden_artifacts(tmp_path) == ["browser-trace.zip"]


def test_artifact_guard_rejects_embedded_lab_references(tmp_path):
    guard = load_lab_module("artifact_guard")
    (tmp_path / "server.js").write_text("load process_lab externally", encoding="utf-8")
    assert guard.forbidden_artifacts(tmp_path) == ["server.js::content:process_lab"]


def test_artifact_guard_ignores_build_cache_but_scans_deployable_output(tmp_path):
    guard = load_lab_module("artifact_guard")
    (tmp_path / "cache").mkdir()
    (tmp_path / "cache" / "compiler.sst").write_text("prefect source index", encoding="utf-8")
    (tmp_path / "server").mkdir()
    (tmp_path / "server" / "route.js").write_text("production", encoding="utf-8")
    assert guard.forbidden_artifacts(tmp_path) == []
    (tmp_path / "server" / "route.js").write_text("load process_lab", encoding="utf-8")
    assert guard.forbidden_artifacts(tmp_path) == ["server/route.js::content:process_lab"]


@pytest.mark.parametrize("dependency", ["prefect", "questionary", "process_lab"])
def test_artifact_guard_rejects_embedded_lab_dependencies(tmp_path, dependency):
    guard = load_lab_module("artifact_guard")
    (tmp_path / "server.js").write_text(f"load {dependency}", encoding="utf-8")
    assert guard.forbidden_artifacts(tmp_path) == [f"server.js::content:{dependency}"]


def test_artifact_guard_requires_real_artifact_directory(tmp_path):
    guard = load_lab_module("artifact_guard")
    with pytest.raises(FileNotFoundError):
        guard.forbidden_artifacts(tmp_path / "missing")


def test_release_ignore_files_exclude_process_lab():
    # The portal ships as a static Pages build; Docker is the only remaining release context.
    for name in (".dockerignore",):
        value = (ROOT / name).read_text(encoding="utf-8")
        assert "development/" in value
        assert "tests/" in value
        assert ".schemathesis/" in value
        assert "apps/portal/.next*/" in value
        assert "**/*-trace.zip" in value


def test_member_experience_is_a_real_prefect_dag_entrypoint():
    flows = (LAB_PACKAGE / "flows.py").read_text(encoding="utf-8")
    cli = (LAB_PACKAGE / "cli.py").read_text(encoding="utf-8")
    assert '@flow(name="PyTorch PH major member experience"' in flows
    assert '"member-experience": member_experience_flow' in flows
    assert 'task_run_name="{label}"' in flows
    for route in (
        "/membership",
        "/dashboard",
        "/career/evidence",
        "/career/resumes",
        "/jobs/opportunities",
        "/events",
        "/leaderboards",
        "/trust",
        "/dashboard/profile",
        "/settings",
    ):
        assert f'"{route}"' in flows
    assert '"member-experience"' in cli


def test_prefect_workspace_configuration_covers_native_sections():
    configuration = (LAB_PACKAGE / "configuration.py").read_text(encoding="utf-8")
    flows = (LAB_PACKAGE / "flows.py").read_text(encoding="utf-8")
    browser = (LAB_PACKAGE / "browser.py").read_text(encoding="utf-8")
    cli = (LAB_PACKAGE / "cli.py").read_text(encoding="utf-8")
    launcher = (LAB_PACKAGE / "launcher.py").read_text(encoding="utf-8")
    for resource in (
        "VARIABLES",
        "ProcessLabServices",
        "ProcessLabSafetyPolicy",
        "GLOBAL_LIMITS",
        "WORK_POOL",
        "QUEUES",
        "DEPLOYMENT_QUEUES",
        "Automation",
        "EventTrigger",
    ):
        assert resource in configuration
    assert 'job_variables={"working_dir": str(REPO_ROOT)}' in configuration
    assert "if deployment_name == DIAGNOSTIC_DEPLOYMENT:" in configuration
    assert 'os.environ.setdefault("PREFECT_API_URL", "http://127.0.0.1:4200/api")' in cli
    assert 'os.environ["PREFECT_API_URL"] = environment["PREFECT_API_URL"]' in launcher
    for workflow in (
        "account-membership",
        "career-opportunities",
        "events-community",
        "privacy-feedback",
    ):
        assert f'"{workflow}"' in flows
    for limit in (
        "pytorch-ph-api-read",
        "pytorch-ph-artifact-build",
        "pytorch-ph-browser-cdp",
        "pytorch-ph-live-scraper",
        "pytorch-ph-model-planning",
    ):
        assert limit in configuration or limit in flows or limit in browser
    assert "emit_event(" in flows


def test_prefect_operations_documentation_explains_each_native_section():
    operations = (ROOT / "development" / "process-lab" / "PREFECT-OPERATIONS.md").read_text(
        encoding="utf-8"
    )
    for section in (
        "Variables",
        "Blocks",
        "Work Pools",
        "Concurrency",
        "Automations",
        "Event Feed",
    ):
        assert section in operations
    assert "pinned Prefect 3.8.3" in operations


def test_prefect_dashboard_tour_is_a_pinned_development_patch():
    dashboard = ROOT / "development" / "prefect-dashboard"
    patch = (dashboard / "patches" / "prefect-3.8.3-joyride.patch").read_text(
        encoding="utf-8"
    )
    builder = (dashboard / "build-dashboard.mjs").read_text(encoding="utf-8")
    cli = (LAB_PACKAGE / "cli.py").read_text(encoding="utf-8")
    launcher = (LAB_PACKAGE / "launcher.py").read_text(encoding="utf-8")
    assert 'from "react-joyride"' in patch
    assert "d8f54b5c4857e933c31aac97e8ef56ea732c5138" in builder
    assert "PREFECT_UI_STATIC_DIRECTORY" in launcher
    assert 'subparsers.add_parser(\n        "demo"' in cli
    assert "def run_demo_stack()" in launcher
    assert '"PYTORCH_PH_DATA_PROVIDER": "local"' in launcher
    assert '"PREFECT_HOME": str(prefect_home)' in launcher
    assert "_run_managed_stack(environment, start_worker=False)" in launcher
    assert "_run_managed_stack(environment, start_worker=True)" in launcher
    assert "TUTORIAL_ROOT" not in launcher


def test_beginner_documentation_has_root_commands_and_two_modes():
    readme = (ROOT / "development" / "process-lab" / "README.md").read_text(
        encoding="utf-8"
    )
    assert "npm run dev" in readme
    assert "npm run dev:manual-login" in readme
    assert "pytorch-ph-process-lab up" in readme
    assert "You do not need to configure those sections by hand" in readme
