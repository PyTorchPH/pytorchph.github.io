"""Resource-aware limits for bounded browser application batches.

This module is runtime policy only: it measures capacity and returns limits,
without knowing about vendor selectors, questionnaire answers, or persistence.
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import BaseModel

MIB = 1024 * 1024


class BrowserResourceSnapshot(BaseModel):
    total_memory_mib: int
    available_memory_mib: int
    swap_used_mib: int
    logical_cpus: int
    physical_cores: int


class BrowserResourceLimits(BaseModel):
    max_workers: int
    max_tabs: int
    max_candidates: int
    reason: str
    snapshot: BrowserResourceSnapshot


def _linux_memory() -> tuple[int, int, int]:
    values: dict[str, int] = {}
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            label, raw = line.split(":", 1)
            values[label] = int(raw.strip().split()[0]) // 1024
    except (OSError, ValueError, IndexError):
        return 0, 0, 0
    total = values.get("MemTotal", 0)
    available = values.get("MemAvailable", values.get("MemFree", 0))
    swap_used = max(0, values.get("SwapTotal", 0) - values.get("SwapFree", 0))
    return total, available, swap_used


def _linux_physical_cores(logical_cpus: int) -> int:
    pairs: set[tuple[str, str]] = set()
    physical_id = ""
    core_id = ""
    try:
        records = Path("/proc/cpuinfo").read_text(encoding="utf-8").split("\n\n")
        for record in records:
            physical_id = ""
            core_id = ""
            for line in record.splitlines():
                if ":" not in line:
                    continue
                label, value = (part.strip() for part in line.split(":", 1))
                if label == "physical id":
                    physical_id = value
                elif label == "core id":
                    core_id = value
            if physical_id and core_id:
                pairs.add((physical_id, core_id))
    except OSError:
        pass
    return len(pairs) or max(1, logical_cpus // 2)


def read_browser_resource_snapshot() -> BrowserResourceSnapshot:
    total, available, swap_used = _linux_memory()
    logical = max(1, os.cpu_count() or 1)
    if not total:
        # Conservative fallback when the platform does not expose MemAvailable.
        total = 4096
        available = 2048
    return BrowserResourceSnapshot(
        total_memory_mib=total,
        available_memory_mib=available,
        swap_used_mib=swap_used,
        logical_cpus=logical,
        physical_cores=_linux_physical_cores(logical),
    )


def calculate_browser_resource_limits(
    snapshot: BrowserResourceSnapshot,
    *,
    requested_workers: int,
    requested_candidates: int,
    requested_tabs: int = 0,
) -> BrowserResourceLimits:
    reserve_mib = max(2048, int(snapshot.total_memory_mib * 0.30))
    usable_mib = max(0, snapshot.available_memory_mib - reserve_mib)
    memory_workers = max(1, usable_mib // 768)
    cpu_workers = max(1, snapshot.physical_cores // 2)
    max_workers = min(requested_workers, memory_workers, cpu_workers, 5)
    swap_pressure = snapshot.swap_used_mib >= 512
    if swap_pressure:
        max_workers = 1

    calculated_tabs = max(
        3,
        min(
            12,
            max(1, snapshot.available_memory_mib - reserve_mib // 2) // 320,
        ),
    )
    if swap_pressure:
        calculated_tabs = min(calculated_tabs, 6)
    max_tabs = min(requested_tabs, calculated_tabs) if requested_tabs else calculated_tabs
    max_tabs = max(2, max_tabs)
    # One job may temporarily own a listing and one application popup.
    max_workers = min(max_workers, max(1, max_tabs // 2))
    max_candidates = min(requested_candidates, max_tabs, 24)
    reason = (
        f"available={snapshot.available_memory_mib}MiB "
        f"reserve={reserve_mib}MiB swap_used={snapshot.swap_used_mib}MiB "
        f"physical_cores={snapshot.physical_cores}"
    )
    return BrowserResourceLimits(
        max_workers=max_workers,
        max_tabs=max_tabs,
        max_candidates=max_candidates,
        reason=reason,
        snapshot=snapshot,
    )
