"""LLM synthesizer.

Cross-references:
- The RoleSpec (target).
- AI-extracted Evidence (relevant repos + rationale).
- Raw documents (PDF/DOCX/etc. — the candidate's existing resume / bio / notes).

Produces a full `Resume` model with a tailored summary, polished bullets, and
prioritized skill ordering. The static synth's fields are filled deterministically
when AI omits them, so the renderers always get a complete model.
"""

from __future__ import annotations

from ..llm import LLMProvider
from ..metrics import ProjectMetric, metrics_by_repo
from ..core.models import (
    ContactInfo,
    Evidence,
    RawDocument,
    Repo,
    Resume,
    RoleSpec,
)
from ..core.principles import HARVARD_PRINCIPLES
from .base import Synthesizer
from .static_synth import StaticSynthesizer

_MAX_DOC_CHARS = 6000
_SYSTEM = (
    "ROLE: top-tier resume writer. OUTPUT: complete ATS-friendly Resume JSON; target-role tailored.\n"
    "RESULTS: impact-first; keep strong existing sentences unchanged; add missing context as a new "
    "short bullet/sentence; never stretch one sentence to carry everything.\n"
    "NUMBERS: Authoritative metrics only; exact values; NEVER invent/estimate/alter/extrapolate.\n"
    "NO METRIC: strong qualitative result; problem solved + effect + demonstrated capability; no fake number.\n"
    "TRUTH: include only evidenced experience/projects.\n"
    "SKILLS: relevance order; compact display groups when truthful: "
    "skill_groups = language/platform parent + evidenced library/framework names only; e.g. "
    "JavaScript -> ReactJS, React Native, Vue; Python -> PyTorch, FastAPI. No explanatory prose. "
    "Do not group unrelated tools; do not hide distinct primary languages.\n"
    "STYLE: clear to a non-expert; verbose result meaning; compact bullets; prefer : - , (); no filler.\n\n"
) + HARVARD_PRINCIPLES


class AISynthesizer(Synthesizer):
    def __init__(
        self, llm: LLMProvider, metrics: list[ProjectMetric] | None = None
    ) -> None:
        self._llm = llm
        self._fallback = StaticSynthesizer()
        self._metrics_by_repo = metrics_by_repo(metrics or [])

    def build(
        self,
        role: RoleSpec,
        repos: list[Repo],
        evidence: list[Evidence],
        documents: list[RawDocument],
    ) -> Resume:
        # Pre-extract contact via static path for reliability; LLM can overwrite.
        baseline = self._fallback.build(role, repos, evidence, documents)

        prompt = self._build_prompt(role, evidence, documents, baseline.contact)
        try:
            resume = self._llm.structured(prompt, schema=Resume, system=_SYSTEM, max_tokens=4096)
        except Exception:
            return baseline

        # Force-correct: role spec must match the requested role.
        resume.role = role
        # Carry over any contact fields LLM left blank.
        resume.contact = _merge_contact(resume.contact, baseline.contact)
        return resume

    def _build_prompt(
        self,
        role: RoleSpec,
        evidence: list[Evidence],
        documents: list[RawDocument],
        contact: ContactInfo,
    ) -> str:
        ev_blob = "\n".join(
            f"- {e.source_id} (score={e.score:.1f}): {e.rationale or e.snippet}\n  bullets: {e.bullets}"
            for e in evidence
        ) or "(none)"
        docs_blob = "\n\n---\n\n".join(
            f"file: {d.filename}\n{d.text[:_MAX_DOC_CHARS]}" for d in documents
        ) or "(no documents provided)"
        metrics_blob = self._metrics_block()
        return (
            f"Target role: {role.label}\n"
            f"Keywords: {', '.join(role.keywords)}\n"
            f"Must-have skills: {', '.join(role.must_have_skills)}\n"
            f"Summary hint: {role.summary_hint or ''}\n\n"
            f"Known contact info: {contact.model_dump_json()}\n\n"
            f"Authoritative metrics (use these EXACT numbers; invent no others):\n{metrics_blob}\n\n"
            f"Role-relevant GitHub projects:\n{ev_blob}\n\n"
            f"Candidate documents (resume, bio, notes):\n{docs_blob}\n\n"
            "Compose the final Resume. Include `role`, `contact`, `summary`, `skills`, "
            "`experience`, `projects` (use the GitHub evidence), `education`, `certifications`. "
            "Education is supporting detail — keep it concise. In each education entry's `notes`, "
            "include academic standing (GPA, Dean's List, scholarships) and ONLY the coursework or "
            "curriculum that demonstrates expertise for THIS target role; omit unrelated subjects. "
            "For `projects`, include only those that genuinely demonstrate THIS role; "
            "omit projects whose real purpose is unrelated to the role even if they share "
            "a programming language. "
            "Use generated_on = today."
        )


    def _metrics_block(self) -> str:
        """Render the per-repo authoritative metric facts for prompt injection."""
        if not self._metrics_by_repo:
            return "(none provided — write qualitative bullets, no invented numbers)"
        lines: list[str] = []
        for repo in sorted(self._metrics_by_repo):
            lines.append(f"- {repo}:")
            for m in self._metrics_by_repo[repo]:
                lines.append(f"    - {m.as_fact()}")
        return "\n".join(lines)


def _merge_contact(primary: ContactInfo, fallback: ContactInfo) -> ContactInfo:
    out = primary.model_copy()
    for field in ("name", "email", "phone", "location", "website", "github", "linkedin", "facebook"):
        if not getattr(out, field):
            setattr(out, field, getattr(fallback, field))
    return out
