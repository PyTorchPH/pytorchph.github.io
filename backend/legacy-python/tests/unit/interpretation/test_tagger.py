from __future__ import annotations

from resume_builder.classification.industry import TaggedProject
from resume_builder.interpretation.models import RetrievedSource
from resume_builder.interpretation.tagger import ProjectTagger


class _FakeLLM:
    def __init__(self, payload):
        self.payload = payload
        self.calls = 0
        self.system = ""
        self.max_tokens = 0

    def structured(self, prompt, schema, system=None, max_tokens=2048):
        self.calls += 1
        self.system = system or ""
        self.max_tokens = max_tokens
        return schema(**self.payload)


def test_tag_returns_tagged_project_with_source_id():
    llm = _FakeLLM(
        {
            "repo_full_name": "ignored",
            "industries": ["artificial intelligence"],
            "skill_subtags": ["Python"],
        }
    )
    tp = ProjectTagger(llm).tag(
        RetrievedSource(
            source_id="owner/repo", kind="project", text="PyTorch model training."
        )
    )
    assert isinstance(tp, TaggedProject)
    assert tp.repo_full_name == "owner/repo"  # forced to the source id
    assert tp.industries == ["artificial intelligence"]


def test_tag_contract_uses_nested_verbose_results_and_conclusion():
    llm = _FakeLLM(
        {
            "repo_full_name": "ignored",
            "results": {
                "quantitative": ["80% faster: 8 minutes saved per run."],
                "qualitative": ["Removed a manual handoff for operators."],
            },
            "conclusion": "Demonstrates workflow automation with measured value.",
        }
    )
    tagged = ProjectTagger(llm).tag(RetrievedSource(source_id="owner/repo", kind="project"))

    assert tagged.model_dump()["results"]["quantitative"] == ["80% faster: 8 minutes saved per run."]
    assert "results.quantitative" in llm.system
    assert "conclusion" in llm.system
    assert llm.max_tokens == 2048


def test_tagged_project_accepts_legacy_flat_impact_fields():
    tagged = TaggedProject(
        repo_full_name="owner/repo",
        quantitative_impact=["2x throughput"],
        qualitative_impact=["Simpler operation"],
    )
    assert tagged.results.quantitative == ["2x throughput"]
    assert tagged.qualitative_impact == ["Simpler operation"]


def test_tag_raises_on_llm_error_for_runner_to_handle():
    import pytest

    class _Boom:
        def structured(self, *a, **k):
            raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        ProjectTagger(_Boom()).tag(RetrievedSource(source_id="s1", kind="post", text="x"))
