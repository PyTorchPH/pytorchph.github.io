r"""Deterministic synthesizer.

Strategy:
- Projects come from Evidence (already filtered/scored by StaticExtractor).
- Contact info, experience, education, certifications come from a LaTeX-formatted
  resume input parsed via regex section headers (\section{...}).
- Skills come from matched_terms across all Evidence + role must-haves.
- Summary uses role.summary_hint as a base.
"""

from __future__ import annotations

import re
from typing import Iterable

from ..core.models import (
    ContactInfo,
    Evidence,
    RawDocument,
    Repo,
    Resume,
    ResumeCertification,
    ResumeEducation,
    ResumeExperience,
    ResumeProject,
    RoleSpec,
)
from .base import Synthesizer

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"\(?\+?\d[\d\s().-]{7,}\d")
_URL_RE = re.compile(r"https?://[^\s)\}]+")
_SECTION_RE = re.compile(r"\\section\*?\{([^}]+)\}([^\\]*(?:\\(?!section)[^\\]*)*)", re.IGNORECASE)


class StaticSynthesizer(Synthesizer):
    def build(
        self,
        role: RoleSpec,
        repos: list[Repo],
        evidence: list[Evidence],
        documents: list[RawDocument],
    ) -> Resume:
        repos_by_name = {r.full_name: r for r in repos}
        projects = [self._evidence_to_project(e, repos_by_name) for e in evidence]

        contact = ContactInfo()
        experience: list[ResumeExperience] = []
        education: list[ResumeEducation] = []
        certifications: list[ResumeCertification] = []
        sections: dict[str, str] = {}

        for doc in documents:
            text = doc.text or ""
            self._merge_contact(contact, text)
            for name, body in _SECTION_RE.findall(text):
                sections.setdefault(name.strip().lower(), body.strip())

        if "experience" in sections:
            experience = self._parse_experience(sections["experience"])
        if "education" in sections:
            education = self._parse_education(sections["education"])
        if "certifications" in sections:
            certifications = self._parse_certifications(sections["certifications"])

        skills = self._derive_skills(role, evidence)
        summary = role.summary_hint or f"Engineer targeting {role.label} roles."

        return Resume(
            role=role,
            contact=contact,
            summary=summary,
            skills=skills,
            experience=experience,
            projects=projects,
            education=education,
            certifications=certifications,
        )

    # ---- helpers ----

    @staticmethod
    def _evidence_to_project(e: Evidence, repos: dict[str, Repo]) -> ResumeProject:
        repo = repos.get(e.source_id)
        return ResumeProject(
            name=repo.name if repo else e.source_id.split("/")[-1],
            url=repo.url if repo else None,
            description=(repo.description if repo else "") or e.snippet,
            bullets=list(e.bullets),
            tech=list(repo.languages) if repo else [],
        )

    @staticmethod
    def _merge_contact(contact: ContactInfo, text: str) -> None:
        if not contact.email:
            m = _EMAIL_RE.search(text)
            if m:
                contact.email = m.group(0)
        if not contact.phone:
            m = _PHONE_RE.search(text)
            if m:
                contact.phone = m.group(0).strip()
        if not contact.github or not contact.linkedin or not contact.website:
            for url in _URL_RE.findall(text):
                low = url.lower()
                if "github.com" in low and not contact.github:
                    contact.github = url
                elif "linkedin.com" in low and not contact.linkedin:
                    contact.linkedin = url
                elif not contact.website:
                    contact.website = url
        if not contact.name:
            m = re.search(r"\\name\{([^}]+)\}", text)
            if m:
                contact.name = m.group(1).strip()
        if not contact.name:
            # Plain-text / PDF inputs have no \name{} — take the first line near the
            # top that looks like a person's name.
            guessed = StaticSynthesizer._guess_name(text)
            if guessed:
                contact.name = guessed

    @staticmethod
    def _guess_name(text: str) -> str:
        """Best-effort name from the first lines of a plain-text/PDF resume.

        Picks the first of the first ~15 non-empty lines that reads like a name:
        2–5 tokens, alphabetic (allowing ., -, accents), no digits/@/URL, and at
        least two tokens starting uppercase.
        """
        lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
        for line in lines[:15]:
            if "@" in line or "http" in line.lower() or any(ch.isdigit() for ch in line):
                continue
            tokens = line.split()
            if not (2 <= len(tokens) <= 5):
                continue
            if not all(re.fullmatch(r"[A-Za-zÀ-ÿ.\-']+", t) for t in tokens):
                continue
            if sum(1 for t in tokens if t[:1].isupper()) >= 2:
                return line
        return ""

    @staticmethod
    def _split_blocks(body: str) -> Iterable[str]:
        for block in re.split(r"\n\s*\n", body):
            block = block.strip()
            if block:
                yield block

    @classmethod
    def _parse_experience(cls, body: str) -> list[ResumeExperience]:
        out: list[ResumeExperience] = []
        for block in cls._split_blocks(body):
            lines = [line.strip(" \t-*•\\") for line in block.splitlines() if line.strip()]
            if not lines:
                continue
            header = lines[0]
            role = header
            company = ""
            if " at " in header:
                role, company = header.split(" at ", 1)
            elif " - " in header:
                role, company = header.split(" - ", 1)
            out.append(
                ResumeExperience(
                    role=role.strip(),
                    company=company.strip(),
                    bullets=[line for line in lines[1:] if line],
                )
            )
        return out

    @classmethod
    def _parse_education(cls, body: str) -> list[ResumeEducation]:
        out: list[ResumeEducation] = []
        for block in cls._split_blocks(body):
            lines = [line.strip(" \t-*•\\") for line in block.splitlines() if line.strip()]
            if not lines:
                continue
            out.append(ResumeEducation(school=lines[0], notes=lines[1:]))
        return out

    @classmethod
    def _parse_certifications(cls, body: str) -> list[ResumeCertification]:
        out: list[ResumeCertification] = []
        for line in body.splitlines():
            cleaned = line.strip(" \t-*•\\")
            if cleaned:
                out.append(ResumeCertification(name=cleaned))
        return out

    @staticmethod
    def _derive_skills(role: RoleSpec, evidence: list[Evidence]) -> list[str]:
        # Dedupe case-insensitively (e.g. "AWS"/"aws", "Docker"/"docker") while
        # preserving the first-seen original casing and ordering.
        seen: dict[str, str] = {}
        for skill in role.must_have_skills:
            seen.setdefault(skill.lower(), skill)
        for e in evidence:
            for term in e.matched_terms:
                seen.setdefault(term.lower(), term)
        for skill in role.nice_to_have:
            seen.setdefault(skill.lower(), skill)
        return list(seen.values())
