from __future__ import annotations

import csv
import io
import json
from pathlib import Path

_DEFAULT_FIELDS = ["title", "stage", "role", "group", "department", "priority", "estimate", "target"]


def tasks_to_csv(tasks: list[dict], fields: list[str] | None = None) -> str:
    cols = fields or _DEFAULT_FIELDS
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(cols)
    for t in tasks:
        writer.writerow([t.get(c, "") for c in cols])
    return buf.getvalue()


def export_board(json_path: str | Path, csv_path: str | Path, event: str | None = None) -> Path:
    data = json.loads(Path(json_path).read_text(encoding="utf-8"))
    tasks = data["tasks"] if isinstance(data, dict) and "tasks" in data else data
    if event:
        tasks = [t for t in tasks if event.lower() in t.get("title", "").lower()]
    out = Path(csv_path)
    out.write_text(tasks_to_csv(tasks), encoding="utf-8")
    return out
