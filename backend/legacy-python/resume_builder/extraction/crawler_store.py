from __future__ import annotations

import json
import re
from pathlib import Path

from .crawler_models import CrawlRun, LearnedLayout


class LayoutStore:
    """Memory-first store with optional local JSON persistence and a replaceable backend seam."""

    def __init__(self, output_dir: Path | None = Path("out/crawler-rules")) -> None:
        self._layouts: dict[str, LearnedLayout] = {}
        self.output_dir = output_dir
        self._load_local_layouts()

    def _load_local_layouts(self) -> None:
        if self.output_dir is None or not self.output_dir.exists():
            return
        for path in self.output_dir.glob("*.json"):
            if path.name == "latest-run.json":
                continue
            try:
                layout = LearnedLayout.model_validate_json(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            self._layouts[layout.layout_fingerprint] = layout

    def get(self, fingerprint: str) -> LearnedLayout | None:
        layout = self._layouts.get(fingerprint)
        return layout.model_copy(deep=True) if layout else None

    def put(self, layout: LearnedLayout) -> None:
        self._layouts[layout.layout_fingerprint] = layout.model_copy(deep=True)
        if self.output_dir is not None:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            domain = re.sub(r"[^a-zA-Z0-9.-]+", "_", layout.domain)
            path = self.output_dir / f"{domain}-{layout.layout_fingerprint}.json"
            path.write_text(layout.model_dump_json(indent=2), encoding="utf-8")

    def all(self) -> list[LearnedLayout]:
        return [layout.model_copy(deep=True) for layout in self._layouts.values()]

    def write_run(self, run: CrawlRun) -> Path | None:
        if self.output_dir is None:
            return None
        self.output_dir.mkdir(parents=True, exist_ok=True)
        path = self.output_dir / "latest-run.json"
        path.write_text(json.dumps(run.model_dump(mode="json"), indent=2), encoding="utf-8")
        return path
