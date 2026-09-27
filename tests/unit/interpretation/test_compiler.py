from __future__ import annotations

from resume_builder.classification.industry import TaggedProject
from resume_builder.interpretation.compiler import compile_tags


def test_compile_concatenates_preserving_each_result():
    a = [TaggedProject(repo_full_name="a", industries=["ai"])]
    b = [TaggedProject(repo_full_name="b", industries=["web"]),
         TaggedProject(repo_full_name="c", industries=["ai", "web"])]
    out = compile_tags(a, b)
    assert [t.repo_full_name for t in out] == ["a", "b", "c"]  # order preserved, nothing merged


def test_compile_drops_none_entries():
    out = compile_tags([TaggedProject(repo_full_name="a"), None])  # type: ignore[list-item]
    assert [t.repo_full_name for t in out] == ["a"]
