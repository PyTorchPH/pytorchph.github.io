"""AI-mode stages with a fake LLM — exercise the structured-output flow without network."""

from __future__ import annotations

from resume_builder.extractors import AIExtractor
from resume_builder.llm.base import LLMProvider
from resume_builder.core.models import Repo, RoleSpec
from resume_builder.role import AIRolePicker


class _ScriptedLLM(LLMProvider):
    name = "scripted"

    def __init__(self, response: str) -> None:
        self._response = response
        self.last_prompt: str | None = None
        self.last_system: str | None = None

    def complete(self, prompt, system=None, max_tokens=1024):
        self.last_prompt = prompt
        self.last_system = system
        return self._response


def test_ai_role_picker_slugifies_id():
    llm = _ScriptedLLM(
        '{"id": "Cybersecurity / Blue Team!!", "label": "Cybersecurity Blue Team", '
        '"keywords": ["SIEM","SOC"], "must_have_skills": ["detection"], '
        '"nice_to_have": ["YARA"], "summary_hint": "Defensive engineer."}'
    )
    role = AIRolePicker(llm).pick("I want a cybersecurity blue team role")
    assert role.id == "cybersecurity-blue-team"
    assert "SIEM" in role.keywords


def test_ai_extractor_filters_zero_score():
    llm = _ScriptedLLM(
        '{"items": ['
        '{"source_kind":"repo","source_id":"me/a","snippet":"","matched_terms":[],'
        '"score":5.0,"rationale":"strong","bullets":["x"]},'
        '{"source_kind":"repo","source_id":"me/b","snippet":"","matched_terms":[],'
        '"score":0.0,"rationale":"weak","bullets":[]}]}'
    )
    repos = [
        Repo(name="a", full_name="me/a", url="u"),
        Repo(name="b", full_name="me/b", url="u"),
    ]
    role = RoleSpec(id="r", label="Role")
    evidence = AIExtractor(llm).extract(repos, role)
    assert [e.source_id for e in evidence] == ["me/a"]
