"""CSV-backed store for project metrics.

The CSV is the source of truth the candidate edits by hand or via `mine-metrics`.
Loading is forgiving (skips blank/garbage rows); saving is deterministic (stable
column order, sorted by repo then label) so diffs stay clean and re-runnable.
"""

from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

from .models import CSV_COLUMNS, ProjectMetric


def load_metrics(path: str | Path) -> list[ProjectMetric]:
    """Load metrics from a CSV. Returns [] if the file does not exist."""
    p = Path(path)
    if not p.is_file():
        return []
    out: list[ProjectMetric] = []
    with p.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            repo = (row.get("repo") or "").strip()
            label = (row.get("metric_label") or "").strip()
            value = (row.get("value") or "").strip()
            # A usable metric needs at least a repo, a label, and a value.
            if not (repo and label and value):
                continue
            out.append(
                ProjectMetric(
                    repo=repo,
                    metric_label=label,
                    value=value,
                    context=(row.get("context") or "").strip(),
                )
            )
    return out


def save_metrics(path: str | Path, metrics: list[ProjectMetric]) -> Path:
    """Write metrics to a CSV with a stable, diff-friendly ordering."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(metrics, key=lambda m: (m.repo.lower(), m.metric_label.lower(), m.value))
    with p.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for m in ordered:
            writer.writerow({c: getattr(m, c) for c in CSV_COLUMNS})
    return p


def metrics_by_repo(metrics: list[ProjectMetric]) -> dict[str, list[ProjectMetric]]:
    """Group metrics by repo. Matches on either the repo `name` or `full_name`
    is the caller's job; this groups on the stored `repo` string verbatim."""
    grouped: dict[str, list[ProjectMetric]] = defaultdict(list)
    for m in metrics:
        grouped[m.repo].append(m)
    return dict(grouped)


def merge_metrics(
    existing: list[ProjectMetric], incoming: list[ProjectMetric]
) -> list[ProjectMetric]:
    """Merge two metric lists, de-duplicating on (repo, metric_label, value).

    Incoming wins on context for an otherwise-identical key, letting a re-run
    refine the qualifier without creating a duplicate row.
    """
    keyed: dict[tuple[str, str, str], ProjectMetric] = {}
    for m in [*existing, *incoming]:
        keyed[(m.repo.lower(), m.metric_label.lower(), m.value.lower())] = m
    return list(keyed.values())
