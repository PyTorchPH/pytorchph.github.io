"""Profile builder and persistence sink for the P3 engine (skills + industry tags)."""
from __future__ import annotations

from pathlib import Path

from ..classification.industry import IndustryClassification, _dedupe
from .models import UserProfile


def build_user_profile(classification: IndustryClassification) -> UserProfile:
    """The profile catcher: only skills + industry tags (no source links stored)."""
    industries = _dedupe(classification.normalized_industries)
    skills = _dedupe(s for p in classification.projects for s in p.skill_subtags)
    return UserProfile(skills=skills, industries=industries)


class ProfileSink:
    """Persists the user profile (skills + industries) as JSON. No github links stored."""

    def __init__(self, out_dir: Path) -> None:
        self._dir = Path(out_dir)
        self._dir.mkdir(parents=True, exist_ok=True)

    def save(self, profile: UserProfile) -> Path:
        path = self._dir / "user_profile.json"
        path.write_text(profile.model_dump_json(indent=2), encoding="utf-8")
        return path
