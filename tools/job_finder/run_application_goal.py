#!/usr/bin/env python3
"""Run one bounded site-adapter inventory or replay cycle for an application goal."""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
from pathlib import Path

ROOT = next(path for path in Path(__file__).resolve().parents if (path / "pyproject.toml").exists())
sys.path.insert(0, str(ROOT / "legacy" / "python"))

from resume_builder.job_application import (  # noqa: E402
    ApplicationGoalStatus,
    ApplicationGoalStore,
    DEFAULT_SITE_RUNTIME_REGISTRY,
    SiteCycleRequest,
)

_STOP_REQUESTED = False


def _request_stop(_signum, _frame) -> None:
    global _STOP_REQUESTED
    _STOP_REQUESTED = True


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2), encoding="utf-8")
    temporary.replace(path)


def _process_identity() -> dict[str, object]:
    start_ticks = ""
    try:
        start_ticks = Path(f"/proc/{os.getpid()}/stat").read_text(encoding="utf-8").split()[21]
    except (OSError, IndexError):
        pass
    return {
        "pid": os.getpid(),
        "pgid": os.getpgrp(),
        "start_ticks": start_ticks,
    }


def _run_command(command: list[str], *, log_path: Path) -> int:
    with log_path.open("a", encoding="utf-8") as stream:
        stream.write("\n$ " + " ".join(command) + "\n")
        stream.flush()
        completed = subprocess.run(
            command,
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=stream,
            stderr=subprocess.STDOUT,
            check=False,
        )
    return completed.returncode


def _next_cycle_number(goal_root: Path) -> int:
    numbers = []
    for path in goal_root.glob("cycle-*"):
        try:
            numbers.append(int(path.name.removeprefix("cycle-")))
        except ValueError:
            continue
    return max(numbers, default=0) + 1


def _retry_jobs(
    goal_root: Path, items, *, output_root: Path | None = None
) -> list[dict[str, object]]:
    retry_ids = {item.task_id for item in items if item.state.value == "observed"}
    if not retry_ids:
        return []
    found: dict[str, dict[str, object]] = {}
    artifact_paths = list(goal_root.glob("cycle-*/manifest.json"))
    if output_root is not None:
        artifact_paths.extend(output_root.glob("*-unattended/*/run.json"))
    manifests = sorted(
        artifact_paths,
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for path in manifests:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for job in payload.get("jobs", []):
            if not isinstance(job, dict):
                continue
            task_id = str(job.get("task_id", ""))
            if task_id in retry_ids and task_id not in found:
                found[task_id] = job
        if retry_ids.issubset(found):
            break
    return [found[task_id] for task_id in sorted(found)]


def supervise(args: argparse.Namespace) -> int:
    store = ApplicationGoalStore(args.database)
    goal = store.get(args.goal_id)
    if goal.status == ApplicationGoalStatus.TARGET_REACHED:
        return 0
    store.set_status(args.goal_id, ApplicationGoalStatus.ACTIVE)

    goal_root = args.output / "goals" / args.goal_id
    process_path = goal_root / "process.json"
    seen_path = goal_root / "attempted-task-ids.json"
    log_path = goal_root / "supervisor.log"
    _write_json(process_path, {"goal_id": args.goal_id, **_process_identity()})
    seen = set()
    if seen_path.is_file():
        try:
            seen = {str(item) for item in json.loads(seen_path.read_text(encoding="utf-8"))}
        except (OSError, json.JSONDecodeError, TypeError):
            seen = set()

    cycle = _next_cycle_number(goal_root)
    try:
        goal = store.get(args.goal_id)
        if goal.status == ApplicationGoalStatus.TARGET_REACHED or goal.remaining == 0:
            return 0
        if goal.available == 0:
            store.set_status(args.goal_id, ApplicationGoalStatus.WAITING_FOR_HUMAN)
            return 3
        cycle_dir = goal_root / f"cycle-{cycle:04d}"
        manifest_path = cycle_dir / "manifest.json"
        inventory_path = cycle_dir / "inventory.json"
        _write_json(seen_path, sorted(seen))
        candidate_limit = min(24, max(6, goal.available * 3))
        adapter = DEFAULT_SITE_RUNTIME_REGISTRY.require(goal.sites[0])
        request = SiteCycleRequest(
            root=ROOT,
            goal=goal,
            manifest_path=manifest_path,
            inventory_report_path=inventory_path,
            attempted_task_ids_path=seen_path,
            artifact_dir=args.artifact_dir,
            database=args.database,
            queue=args.queue,
            output=args.output,
            cdp_url=args.cdp_url,
            candidate_limit=candidate_limit,
            max_parallel=args.max_parallel,
        )
        retry_jobs = _retry_jobs(
            goal_root,
            store.items(args.goal_id),
            output_root=args.output,
        )
        if retry_jobs:
            _write_json(manifest_path, {"jobs": retry_jobs})
        else:
            collect_code = _run_command(adapter.collect_command(request), log_path=log_path)
            inventory_status = "error"
            if inventory_path.is_file():
                try:
                    inventory_status = str(
                        json.loads(inventory_path.read_text(encoding="utf-8")).get(
                            "status", "error"
                        )
                    )
                except (OSError, json.JSONDecodeError):
                    pass
            if inventory_status == "human_required" or collect_code == 3:
                store.set_status(args.goal_id, ApplicationGoalStatus.WAITING_FOR_HUMAN)
                return 3
            if collect_code != 0 or inventory_status != "ready" or not manifest_path.is_file():
                store.set_status(args.goal_id, ApplicationGoalStatus.WAITING_FOR_CANDIDATES)
                return 4 if inventory_status == "error" else 2

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        task_ids = {
            str(item.get("task_id", ""))
            for item in manifest.get("jobs", [])
            if isinstance(item, dict) and item.get("task_id")
        }
        if not task_ids:
            store.set_status(args.goal_id, ApplicationGoalStatus.WAITING_FOR_CANDIDATES)
            return 2
        seen.update(task_ids)
        _write_json(seen_path, sorted(seen))

        _run_command(adapter.run_command(request), log_path=log_path)
        goal = store.get(args.goal_id)
        if goal.status == ApplicationGoalStatus.TARGET_REACHED:
            return 0
        items = store.items(args.goal_id)
        current = [item for item in items if item.task_id in task_ids]
        if current and all(item.state.value in {"human_handoff", "reserved"} for item in current):
            store.set_status(args.goal_id, ApplicationGoalStatus.WAITING_FOR_HUMAN)
            return 3
        store.set_status(args.goal_id, ApplicationGoalStatus.WAITING_FOR_CANDIDATES)
        return 2
    finally:
        process_path.unlink(missing_ok=True)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--goal-id", required=True)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    parser.add_argument(
        "--database",
        type=Path,
        default=ROOT / "var" / "state" / "job-applications" / "submissions.sqlite3",
    )
    parser.add_argument(
        "--queue",
        type=Path,
        default=ROOT / "var" / "state" / "job-applications" / "verification-queue.json",
    )
    parser.add_argument("--output", type=Path, default=ROOT / "out")
    parser.add_argument("--max-parallel", type=int, default=3)
    return parser


def main() -> int:
    args = _parser().parse_args()
    if not args.artifact_dir.is_dir():
        raise SystemExit(f"approved resume artifact directory is unavailable: {args.artifact_dir}")
    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)
    return supervise(args)


if __name__ == "__main__":
    raise SystemExit(main())
