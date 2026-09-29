from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import webbrowser

from .artifact_guard import forbidden_artifacts
from .settings import LabSettings


def _flows():
    try:
        from .flows import FLOW_REGISTRY
    except ImportError as exc:
        raise SystemExit(
            "Process Lab dependencies are missing. Run: pip install -e development/process-lab"
        ) from exc
    return FLOW_REGISTRY


def main() -> int:
    # Every command targets the visible local UI. This prevents Prefect from
    # silently starting an unrelated ephemeral server when the variable is unset.
    os.environ.setdefault("PREFECT_API_URL", "http://127.0.0.1:4200/api")
    parser = argparse.ArgumentParser(description="Local-only PyTorch PH process lab.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("list", help="List fixed Prefect workflows.")
    doctor = subparsers.add_parser("doctor", help="Report external Process Lab prerequisites.")
    doctor.add_argument(
        "--demo", action="store_true", help="Check only the beginner demo prerequisites."
    )
    subparsers.add_parser("configure", help="Create or update managed Prefect resources.")
    subparsers.add_parser(
        "demo", help="Start the beginner tutorial with safe synthetic local data."
    )
    subparsers.add_parser(
        "up", help="Start local product services, browser tabs, and Prefect UI."
    )
    server = subparsers.add_parser("server", help="Start Prefect's maintained local UI/API.")
    server.add_argument("--host", default="127.0.0.1")
    run = subparsers.add_parser("run", help="Run one fixed workflow.")
    workflow_names = [
        "api-contracts",
        "browser-lifecycle",
        "member-experience",
        "account-membership",
        "career-opportunities",
        "events-community",
        "privacy-feedback",
        "scraper-economy",
        "evidence-compilation",
        "resume-build",
        "end-to-end",
    ]
    run.add_argument("workflow", choices=workflow_names)
    run.add_argument("--seed-url", default="")
    run.add_argument("--crawl-artifact", default="")
    run.add_argument("--gh-user", default="")
    run.add_argument("--role", default="")
    run.add_argument("--include-login", action="store_true")
    run.add_argument("--property-checks", action="store_true")
    open_flow = subparsers.add_parser(
        "open", help="Choose, run, and open a workflow's native Prefect graph."
    )
    open_flow.add_argument(
        "--workflow",
        choices=[
            "member-experience",
            "account-membership",
            "career-opportunities",
            "events-community",
            "privacy-feedback",
            "api-contracts",
            "browser-lifecycle",
        ],
    )
    open_flow.add_argument("--no-browser", action="store_true")
    guard = subparsers.add_parser(
        "guard-artifact", help="Assert a release artifact excludes the lab."
    )
    guard.add_argument("artifact")
    args = parser.parse_args()

    if args.command == "list":
        for name in _flows():
            print(name)
        return 0
    if args.command == "doctor":
        from .launcher import prerequisites

        values = prerequisites()
        print(json.dumps(values, indent=2))
        if args.demo:
            return 0 if values["npm"] and values["prefect"] else 1
        return 0 if all(values.values()) else 1
    if args.command == "configure":
        from .configuration import configure_workspace

        print(json.dumps(configure_workspace(), indent=2))
        return 0
    if args.command == "demo":
        from .launcher import run_demo_stack

        return run_demo_stack()
    if args.command == "up":
        from .launcher import run_local_stack

        return run_local_stack()
    if args.command == "server":
        return subprocess.call(
            [sys.executable, "-m", "prefect", "server", "start", "--host", args.host]
        )
    if args.command == "guard-artifact":
        matches = forbidden_artifacts(__import__("pathlib").Path(args.artifact).resolve())
        if matches:
            print(json.dumps({"ok": False, "matches": matches}, indent=2))
            return 1
        print(json.dumps({"ok": True, "artifact": args.artifact}, indent=2))
        return 0

    if args.command == "open":
        selected_name = args.workflow
        if not selected_name:
            import questionary

            choices = [
                questionary.Choice("Major Member Experience", "member-experience"),
                questionary.Choice("Account & Membership", "account-membership"),
                questionary.Choice("Career & Opportunities", "career-opportunities"),
                questionary.Choice("Events & Community", "events-community"),
                questionary.Choice("Privacy, Profile & Feedback", "privacy-feedback"),
                questionary.Separator("Advanced developer verification"),
                questionary.Choice("API Contracts", "api-contracts"),
                questionary.Choice("Browser Lifecycle", "browser-lifecycle"),
            ]
            selected_name = questionary.select(
                "Which PyTorch PH workflow should Prefect visualize?", choices=choices
            ).ask()
        if not selected_name:
            print("No workflow selected.")
            return 0
        state = _flows()[selected_name](return_state=True)
        run_id = state.state_details.flow_run_id
        if not run_id:
            raise RuntimeError("Prefect did not return a flow-run ID.")
        url = f"http://127.0.0.1:4200/runs/flow-run/{run_id}"
        print(f"Graph: {url}\nPress F in the Prefect graph to toggle fullscreen.")
        if not args.no_browser:
            webbrowser.open(url)
        print(json.dumps(state.result(), indent=2, default=str))
        return 0

    settings = LabSettings.from_env()
    settings.ensure_local_dirs()
    selected = _flows()[args.workflow]
    if args.workflow == "api-contracts":
        result = selected(run_property_checks=args.property_checks)
    elif args.workflow == "browser-lifecycle":
        result = selected(include_login=args.include_login)
    elif args.workflow in {
        "member-experience",
        "account-membership",
        "career-opportunities",
        "events-community",
        "privacy-feedback",
    }:
        result = selected()
    elif args.workflow == "scraper-economy":
        if not args.seed_url:
            parser.error("--seed-url is required for scraper-economy")
        result = selected(seed_url=args.seed_url)
    elif args.workflow == "evidence-compilation":
        if not args.crawl_artifact:
            parser.error("--crawl-artifact is required for evidence-compilation")
        result = selected(crawl_artifact=args.crawl_artifact)
    elif args.workflow == "resume-build":
        if not args.gh_user or not args.role:
            parser.error("--gh-user and --role are required for resume-build")
        result = selected(gh_user=args.gh_user, role=args.role)
    else:
        if not args.seed_url or not args.gh_user or not args.role:
            parser.error("--seed-url, --gh-user, and --role are required for end-to-end")
        result = selected(seed_url=args.seed_url, gh_user=args.gh_user, role=args.role)
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
