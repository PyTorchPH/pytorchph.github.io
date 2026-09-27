"""Bounded tool surface exposing normalized career evidence to the answer agent."""

from __future__ import annotations

import re

from resume_builder.core.models import Resume

from .models import EvidenceCitation

_QUERY_STOPWORDS = frozenset(
    {
        "about",
        "and",
        "describe",
        "do",
        "experience",
        "have",
        "how",
        "many",
        "professional",
        "please",
        "tell",
        "the",
        "using",
        "what",
        "with",
        "work",
        "years",
        "you",
        "your",
    }
)


def _tokens(value: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9+#.]+", value.lower())
        if len(token) > 1 and token not in _QUERY_STOPWORDS
    }


class CareerEvidenceTool:
    name = "search_career_evidence"

    def __init__(self, resume: Resume, *, max_items: int = 18) -> None:
        self.resume = resume
        self.max_items = max_items
        self._items = self._build_items()

    def search(self, query: str) -> list[EvidenceCitation]:
        wanted = _tokens(query)
        ranked = [(len(wanted & _tokens(item.text)), item) for item in self._items]
        ranked.sort(key=lambda pair: pair[0], reverse=True)
        return [item for score, item in ranked if score > 0][: self.max_items]

    def _build_items(self) -> list[EvidenceCitation]:
        items: list[EvidenceCitation] = []

        def add(category: str, text: str) -> None:
            cleaned = re.sub(r"\s+", " ", text).strip()
            if cleaned:
                items.append(EvidenceCitation(
                    evidence_id=f"{category}:{len(items)}", category=category, text=cleaned
                ))

        add("summary", self.resume.summary)
        for group in self.resume.skill_groups:
            add("skill_group", f"{group.name}: {', '.join(group.items)}")
        for skill in self.resume.skills:
            add("skill", skill)
        for experience in self.resume.experience:
            add("experience", f"{experience.role} at {experience.company}")
            for bullet in experience.bullets:
                add("experience", bullet)
        for project in self.resume.projects:
            add("project", f"{project.name}: {project.description}")
            for bullet in [*project.bullets, *project.quantitative_impact, *project.qualitative_impact]:
                add("project", bullet)
        for achievement in self.resume.achievements:
            add("achievement", f"{achievement.title}: {achievement.snippet}")
            for impact in [*achievement.quantitative_impact, *achievement.qualitative_impact]:
                add("achievement", impact)
        for education in self.resume.education:
            add("education", f"{education.degree or ''} {education.field or ''} at {education.school}")
        for certification in self.resume.certifications:
            add("certification", f"{certification.name} - {certification.issuer or ''}")
        for academic in self.resume.academic_highlights:
            add("academic", f"{academic.label}: {academic.value}")
        return items
