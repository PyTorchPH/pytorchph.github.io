"""Per-project measurable-impact metrics.

These are the *authoritative* numbers a candidate supplies (or confirms) for a
project — dataset size, rows generated, accuracy, users served, latency won, etc.
The synthesizer grounds its bullets on these facts and never invents numbers; a
project with no metric simply gets a qualitative bullet.

The on-disk form is a flat CSV with one row per metric (a project may have many):

    repo,metric_label,value,context
    rag-bot,docs indexed,2.1M chunks,Wikipedia dump
    rag-bot,users served,1.2k/mo,production
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

# Canonical CSV column order. Kept tiny and human-editable on purpose.
CSV_COLUMNS = ["repo", "metric_label", "value", "context"]


class ProjectMetric(BaseModel):
    """One measurable fact about one project, keyed by repo."""

    repo: str = Field(..., description="Repo name or full_name the metric belongs to.")
    metric_label: str = Field(..., description="What is measured, e.g. 'rows generated'.")
    value: str = Field(..., description="Kept as text to preserve units: '2.1M chunks', '40%'.")
    context: str = Field("", description="Optional qualifier, e.g. 'vs baseline', 'synthetic'.")

    @field_validator("repo", "metric_label", "value", "context", mode="before")
    @classmethod
    def _strip(cls, v: object) -> str:
        return str(v).strip() if v is not None else ""

    def as_fact(self) -> str:
        """One-line authoritative fact for prompt injection."""
        ctx = f" ({self.context})" if self.context else ""
        return f"{self.metric_label}: {self.value}{ctx}"
