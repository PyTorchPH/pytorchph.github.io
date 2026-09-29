from __future__ import annotations

from resume_builder.classification.industry import TaggedProject
from resume_builder.interpretation.normalizer import GlobalNormalizer


class _MapLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        return schema(
            industry_map={"ai": "artificial intelligence"}, skill_map={"js": "JavaScript"}
        )


def _projects():
    return [
        TaggedProject(repo_full_name="a", industries=["ai"], skill_subtags=["js"]),
        TaggedProject(
            repo_full_name="b",
            industries=["artificial intelligence"],
            skill_subtags=["JavaScript"],
        ),
    ]


def test_normalize_merges_industries_and_skills():
    cls = GlobalNormalizer(_MapLLM()).normalize(_projects())
    assert cls.normalized_industries == ["artificial intelligence"]  # ai + artificial intelligence → one
    # every project rewritten to canonical labels
    assert all("ai" not in p.industries for p in cls.projects)
    assert all("js" not in p.skill_subtags for p in cls.projects)


def test_normalize_falls_back_deterministically_on_llm_error():
    class _Boom:
        def structured(self, *a, **k):
            raise RuntimeError("boom")

    cls = GlobalNormalizer(_Boom()).normalize(
        [
            TaggedProject(
                repo_full_name="a",
                industries=["AI", "ai"],
                skill_subtags=["Python", "python"],
            ),
        ]
    )
    # deterministic lowercase/dedup fallback still de-duplicates
    assert cls.normalized_industries == ["ai"]
    assert cls.projects[0].skill_subtags == ["Python"]
