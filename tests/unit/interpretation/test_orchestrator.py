from __future__ import annotations

from resume_builder.extraction.models import CleanedSource
from resume_builder.interpretation import interpret


class _FakeLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        name = schema.__name__
        if name == "TaggedProject":
            return schema(repo_full_name="x", industries=["ai"], skill_subtags=["Python"])
        if name == "_AliasMap":
            return schema(industry_map={"ai": "artificial intelligence"}, skill_map={})
        return schema()


def test_interpret_end_to_end():
    projects = [CleanedSource(source_id="owner/repo", kind="github_readme", text="PyTorch model.")]
    classification, report, profile = interpret(_FakeLLM(), projects=projects)
    assert report.sent == 1 and report.returned == 1
    assert classification.normalized_industries == ["artificial intelligence"]
    assert profile.skills == ["Python"]
    assert profile.industries == ["artificial intelligence"]
