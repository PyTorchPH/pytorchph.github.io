"""LLM-driven relevance extractor.

Batches repo metadata + README excerpts in a single prompt and asks for a ranked,
filtered list of Evidence with one-line rationales and 1-3 impact-oriented bullets.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from ..llm import LLMProvider
from ..core.models import Evidence, Repo, RoleSpec
from ..core.principles import HARVARD_PRINCIPLES
from .base import Extractor

_MAX_README_CHARS = 1500
_SYSTEM = (
    "You are a resume strategist. You filter a candidate's GitHub repos for relevance "
    "to a target role. Be ruthless — only include repos that show real, role-relevant work. "
    "For each kept repo, write 1–3 short impact-focused bullets that could appear on a resume.\n\n"
) + HARVARD_PRINCIPLES


class _AIEvidenceList(BaseModel):
    items: list[Evidence] = Field(default_factory=list)


class AIExtractor(Extractor):
    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    def extract(self, repos: list[Repo], role: RoleSpec) -> list[Evidence]:
        if not repos:
            return []
        repo_blob = "\n\n---\n\n".join(self._format_repo(r) for r in repos if not r.archived)
        prompt = (
            f"Target role: {role.label}\n"
            f"Role keywords: {', '.join(role.keywords)}\n"
            f"Must-have skills: {', '.join(role.must_have_skills)}\n\n"
            "Candidate GitHub repos:\n\n"
            f"{repo_blob}\n\n"
            "Return only the repos that meaningfully demonstrate skills/experience for the target role. "
            "For each, set source_kind='repo', source_id=<full_name>, a short rationale, "
            "1–3 bullets, and a relevance score from 0.0 to 10.0. Sort by score descending."
        )
        result = self._llm.structured(prompt, schema=_AIEvidenceList, system=_SYSTEM)
        return [e for e in result.items if e.score > 0]

    @staticmethod
    def _format_repo(repo: Repo) -> str:
        readme = (repo.readme or "")[:_MAX_README_CHARS]
        return (
            f"full_name: {repo.full_name}\n"
            f"url: {repo.url}\n"
            f"description: {repo.description or ''}\n"
            f"languages: {', '.join(repo.languages)}\n"
            f"topics: {', '.join(repo.topics)}\n"
            f"readme_excerpt:\n{readme}"
        )
