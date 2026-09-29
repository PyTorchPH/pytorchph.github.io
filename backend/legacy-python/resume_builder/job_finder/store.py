from __future__ import annotations

import re
from pathlib import Path

from .models import JobListingRun, JobScrapeVisualizationArtifact, LearnedJobListingLayout


class JobListingLayoutStore:
    """Memory-first store for learned job-listing layout rules."""

    def __init__(self, output_dir: Path | None = Path("out/job-finder-rules")) -> None:
        self.output_dir = output_dir
        self._layouts: dict[tuple[str, str], LearnedJobListingLayout] = {}
        self._load_local_layouts()

    def _load_local_layouts(self) -> None:
        if self.output_dir is None or not self.output_dir.exists():
            return
        for path in self.output_dir.glob("*.json"):
            try:
                layout = LearnedJobListingLayout.model_validate_json(
                    path.read_text(encoding="utf-8")
                )
            except Exception:
                continue
            self._layouts[(layout.domain.lower(), layout.layout_fingerprint)] = layout

    def get(
        self, layout_fingerprint: str, *, domain: str | None = None
    ) -> LearnedJobListingLayout | None:
        layout = None
        if domain is not None:
            layout = self._layouts.get((domain.lower(), layout_fingerprint))
        else:
            matches = [
                candidate
                for (candidate_domain, candidate_fingerprint), candidate in self._layouts.items()
                if candidate_fingerprint == layout_fingerprint
            ]
            layout = matches[0] if len(matches) == 1 else None
        return layout.model_copy(deep=True) if layout else None

    def put(self, layout: LearnedJobListingLayout) -> None:
        self._layouts[(layout.domain.lower(), layout.layout_fingerprint)] = layout.model_copy(
            deep=True
        )
        if self.output_dir is None:
            return
        self.output_dir.mkdir(parents=True, exist_ok=True)
        domain = re.sub(r"[^a-zA-Z0-9.-]+", "_", layout.domain)
        path = self.output_dir / f"{domain}-{layout.layout_fingerprint}.json"
        path.write_text(layout.model_dump_json(indent=2), encoding="utf-8")

    def all(self) -> list[LearnedJobListingLayout]:
        return [layout.model_copy(deep=True) for layout in self._layouts.values()]


class JobScrapeArtifactStore:
    """Persist model rules beside their deterministic scraping output for inspection."""

    def __init__(self, output_dir: Path | None = Path("out/job-finder-runs")) -> None:
        self.output_dir = output_dir

    def put(
        self,
        run: JobListingRun,
        layout: LearnedJobListingLayout,
        *,
        source_label: str = "job finder run",
        rendered_dom: str | None = None,
    ) -> JobScrapeVisualizationArtifact:
        artifact = JobScrapeVisualizationArtifact(
            source_label=source_label,
            model_output=layout,
            scraping_output=run,
            rendered_dom=rendered_dom,
        )
        if self.output_dir is not None:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            domain = re.sub(r"[^a-zA-Z0-9.-]+", "_", layout.domain)
            path = self.output_dir / f"{domain}-{layout.layout_fingerprint}.json"
            path.write_text(artifact.model_dump_json(indent=2), encoding="utf-8")
        return artifact

    def latest(self) -> JobScrapeVisualizationArtifact | None:
        if self.output_dir is None or not self.output_dir.exists():
            return None
        paths = sorted(self.output_dir.glob("*.json"), key=lambda path: path.stat().st_mtime)
        for path in reversed(paths):
            try:
                return JobScrapeVisualizationArtifact.model_validate_json(
                    path.read_text(encoding="utf-8")
                )
            except Exception:
                continue
        return None
