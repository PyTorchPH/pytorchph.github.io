from __future__ import annotations

import re

from ..llm import LLMProvider
from ..core.models import RoleSpec
from ..core.principles import HARVARD_PRINCIPLES
from .base import RolePicker

_SYSTEM = (
    "You are a resume strategist. Given a free-form target-role description from a candidate, "
    "produce a structured RoleSpec capturing keywords, must-have skills, and nice-to-have skills "
    "that recruiters/ATS systems screen for. Be specific and industry-realistic.\n\n"
) + HARVARD_PRINCIPLES


class AIRolePicker(RolePicker):
    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    def pick(self, selection: str) -> RoleSpec:
        prompt = (
            f"Candidate's target-role description:\n\n{selection}\n\n"
            "Produce a RoleSpec. The `id` must be kebab-case derived from the role label. "
            "Provide 8–15 keywords, 3–6 must_have_skills, 3–6 nice_to_have, and a one-line "
            "summary_hint that is specific and evidence-based (name concrete technologies/domains, "
            "not generic traits like 'hardworking')."
        )
        spec = self._llm.structured(prompt, schema=RoleSpec, system=_SYSTEM)
        spec.id = _slugify(spec.id or spec.label)
        return spec


def _slugify(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-") or "custom-role"
