"""Regex + keyword-based extractor.

Scores each repo against:
1. Role-specific keywords (case-insensitive substring match).
2. Configured weighted regex categories from `regex_patterns.json`.

The same patterns config is loaded once and reused across all repos. Adding new
pattern categories requires zero code changes.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterable

from ..core.models import Evidence, Repo, RoleSpec
from .base import Extractor


class StaticExtractor(Extractor):
    def __init__(self, regex_patterns_path: Path, min_score: float = 2.5) -> None:
        self._categories = self._load_categories(regex_patterns_path)
        self._min_score = min_score

    @staticmethod
    def _load_categories(path: Path) -> list[tuple[str, list[re.Pattern[str]], float]]:
        data = json.loads(path.read_text(encoding="utf-8"))
        compiled: list[tuple[str, list[re.Pattern[str]], float]] = []
        for cat_name, cat in (data.get("categories") or {}).items():
            patterns = [re.compile(p) for p in cat.get("patterns", [])]
            weight = float(cat.get("weight", 1.0))
            compiled.append((cat_name, patterns, weight))
        return compiled

    def extract(self, repos: list[Repo], role: RoleSpec) -> list[Evidence]:
        evidence: list[Evidence] = []
        for repo in repos:
            if repo.archived:
                continue
            haystack = self._haystack(repo)
            score, matched, snippet = self._score_repo(haystack, role)
            if score < self._min_score:
                continue
            evidence.append(
                Evidence(
                    source_kind="repo",
                    source_id=repo.full_name,
                    snippet=snippet,
                    matched_terms=sorted(matched),
                    score=score,
                    bullets=self._suggest_bullets(repo, matched),
                )
            )
        evidence.sort(key=lambda e: e.score, reverse=True)
        return evidence

    @staticmethod
    def _haystack(repo: Repo) -> str:
        parts = [
            repo.name,
            repo.description or "",
            " ".join(repo.topics),
            " ".join(repo.languages),
            repo.readme or "",
        ]
        return "\n".join(parts)

    def _score_repo(
        self, haystack: str, role: RoleSpec
    ) -> tuple[float, set[str], str]:
        matched: set[str] = set()
        score = 0.0
        hay_lower = haystack.lower()

        # Role keywords: simple substring scoring (weight 1.5 per hit, capped).
        kw_hits = 0
        for kw in role.keywords:
            if kw.lower() in hay_lower:
                matched.add(kw)
                kw_hits += 1
        score += min(kw_hits, 6) * 1.5

        # Must-have skills weigh more.
        for skill in role.must_have_skills:
            if skill.lower() in hay_lower:
                matched.add(skill)
                score += 2.0

        # Regex categories.
        for cat_name, patterns, weight in self._categories:
            for pattern in patterns:
                hits = pattern.findall(haystack)
                if hits:
                    matched.update(_flatten_matches(hits))
                    score += weight * min(len(hits), 3)

        snippet = self._snippet(haystack, matched)
        return score, matched, snippet

    @staticmethod
    def _snippet(haystack: str, matched: Iterable[str], window: int = 120) -> str:
        for term in matched:
            idx = haystack.lower().find(term.lower())
            if idx >= 0:
                start = max(0, idx - window // 2)
                end = min(len(haystack), idx + window // 2)
                return haystack[start:end].replace("\n", " ").strip()
        return (haystack[:window] or "").replace("\n", " ").strip()

    @staticmethod
    def _suggest_bullets(repo: Repo, matched: set[str]) -> list[str]:
        # The repo description already fills ResumeProject.description and the languages
        # fill the Tech line, so the only non-redundant bullet is the *additional*
        # role-relevant signal: matched terms that are not languages. De-duplicate
        # case-insensitively so "Python" and "python" don't both appear.
        langs = {lang.lower() for lang in repo.languages}
        seen: set[str] = set()
        extras: list[str] = []
        for term in sorted(matched, key=str.lower):
            key = term.lower()
            if key in seen or key in langs:
                continue
            seen.add(key)
            extras.append(term)
        if not extras:
            return []
        return [f"Demonstrates: {', '.join(extras[:6])}"]


def _flatten_matches(hits: list) -> list[str]:
    out: list[str] = []
    for h in hits:
        if isinstance(h, tuple):
            out.extend([x for x in h if x])
        elif h:
            out.append(h)
    return out
