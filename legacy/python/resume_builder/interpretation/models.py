from __future__ import annotations

from pydantic import BaseModel, Field


class RetrievedSource(BaseModel):
    """One source entering tagging, normalized by the retrieval middleman."""

    source_id: str
    kind: str  # "project" | "post" | "document"
    title: str = ""
    text: str = ""
    origin: str = ""  # "github" | "facebook" | "website" | "upload" ...


class TagRunReport(BaseModel):
    """KPI/reconciliation for one parallel tagging run."""

    sent: int = 0
    returned: int = 0
    failed: int = 0
    failures: list[str] = Field(default_factory=list)  # source_ids that never returned
    elapsed_s: float = 0.0

    @property
    def success_rate(self) -> float:
        return self.returned / self.sent if self.sent else 0.0


class UserProfile(BaseModel):
    """The 'profile catcher' output: only skills + industry tags (no source links)."""

    skills: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
