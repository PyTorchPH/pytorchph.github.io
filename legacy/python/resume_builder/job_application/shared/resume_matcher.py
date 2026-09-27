"""Configurable deterministic matching for role-specific resume artifacts."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


@dataclass(frozen=True)
class ResumeArtifactProfile:
    filename: str
    terms: tuple[str, ...]


def select_resume_artifact(
    job_title: str,
    artifact_dir: Path,
    profiles: Sequence[ResumeArtifactProfile],
    *,
    job_description: str = "",
    title_weight: int = 3,
    description_weight: int = 1,
    default_filename: str | None = None,
) -> Path | None:
    """Score configured artifacts without assuming any ATS or website."""
    if not profiles:
        return None
    title = f" {job_title.casefold()} "
    description = f" {job_description.casefold()} "
    scores = {
        profile.filename: sum(title_weight for term in profile.terms if term.casefold() in title)
        + sum(description_weight for term in profile.terms if term.casefold() in description)
        for profile in profiles
    }
    filename = max(scores, key=scores.get)
    if scores[filename] == 0:
        if default_filename is None:
            return None
        filename = default_filename
    candidate = artifact_dir / filename
    return candidate.resolve() if candidate.is_file() else None
