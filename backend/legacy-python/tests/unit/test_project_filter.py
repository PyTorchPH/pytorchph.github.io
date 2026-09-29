from __future__ import annotations

from resume_builder.core.models import ResumeProject, RoleSpec
from resume_builder.llm.base import LLMProvider
from resume_builder.orchestration import pipeline as P


def _role(**kw) -> RoleSpec:
    base = dict(id="r", label="R", keywords=[], must_have_skills=[], nice_to_have=[])
    base.update(kw)
    return RoleSpec(**base)


def test_keyword_fallback_keeps_relevant_drops_unrelated():
    role = _role(keywords=["compiler", "C++"])
    projects = [
        ResumeProject(name="Andrew-mini-compiler", description="A small compiler", tech=["C++"]),
        ResumeProject(name="codespaces-react", description="A React starter", tech=["JavaScript"]),
    ]
    kept = P._filter_projects_by_role(projects, role, llm=None)
    names = [p.name for p in kept]
    assert "Andrew-mini-compiler" in names
    assert "codespaces-react" not in names


def test_keyword_fallback_empty_when_nothing_matches():
    role = _role(keywords=["pytorch", "tensorflow"])
    projects = [ResumeProject(name="codespaces-react", description="React", tech=["JavaScript"])]
    assert P._filter_projects_by_role(projects, role, llm=None) == []


class _StubLLM(LLMProvider):
    name = "stub"

    def __init__(self, keep_indices: dict[int, str | None]):
        self._keep = keep_indices

    def complete(self, *a, **k):
        raise NotImplementedError

    def structured(self, prompt, schema, system=None, max_tokens=2048):
        items = [
            {"index": i, "relevant": i in self._keep, "focused_description": self._keep.get(i)}
            for i in range(prompt.count("\n["))
        ]
        return schema.model_validate({"items": items})


def test_ai_filter_keeps_only_verdict_relevant_and_reframes():
    role = _role(keywords=["compiler"])
    projects = [
        ResumeProject(name="Andrew-mini-compiler", description="raw", tech=["C++"]),
        ResumeProject(name="codespaces-react", description="raw", tech=["JS"]),
    ]
    llm = _StubLLM({0: "A hand-written compiler with lexer, parser, and codegen."})
    kept = P._filter_projects_by_role(projects, role, llm=llm)
    assert [p.name for p in kept] == ["Andrew-mini-compiler"]
    assert kept[0].description == "A hand-written compiler with lexer, parser, and codegen."
