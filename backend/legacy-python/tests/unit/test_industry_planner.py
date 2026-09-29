from __future__ import annotations

from resume_builder.classification.industry import (
    IndustryClassification,
    TaggedAchievement,
    TaggedProject,
    compact_source_display,
    plan_industry_resumes,
)
from resume_builder.llm.base import LLMProvider
from resume_builder.core.models import Repo, ResumeAchievement
from resume_builder.classification.industry import IndustryClassifier


class _ClassifierLLM(LLMProvider):
    name = "classifier"

    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.last_system: str | None = None

    def complete(self, *args, **kwargs):
        raise NotImplementedError

    def structured(self, prompt, schema, system=None, max_tokens=2048):
        self.last_system = system
        return schema.model_validate(self.payload)


def test_ai_classifier_owns_industry_normalization_prompt():
    llm = _ClassifierLLM(
        {
            "normalized_industries": ["applied ai"],
            "projects": [
                {
                    "repo_full_name": "me/rag-agent",
                    "industries": ["applied ai"],
                    "skill_subtags": ["RAG"],
                    "summary": "RAG agent.",
                }
            ],
            "achievements": [],
            "extraction_rules": [],
        }
    )

    result = IndustryClassifier(llm).classify(
        repos=[Repo(name="rag-agent", full_name="me/rag-agent", url="https://github.com/me/rag-agent")],
        achievements=[],
    )

    assert result.normalized_industries == ["applied ai"]
    assert llm.last_system is not None
    assert "Discover and normalize industry names freely" in llm.last_system


def test_static_fallback_uses_repo_topics_not_hardcoded_taxonomy():
    repo = Repo(
        name="platform",
        full_name="me/platform",
        url="https://github.com/me/platform",
        topics=["career-intelligence", "student-success"],
    )

    result = IndustryClassifier(llm=None).classify(repos=[repo], achievements=[])

    assert result.projects[0].industries == ["career intelligence", "student success"]


def test_planner_requires_github_project_for_industry_and_matches_achievements_by_skill():
    repos = [
        Repo(
            name="rag-agent",
            full_name="me/rag-agent",
            url="https://github.com/me/rag-agent",
            description="RAG agent",
            languages=["Python"],
        )
    ]
    achievements = [
        ResumeAchievement(
            title="Built retrieval demo",
            source="facebook",
            url="https://facebook.com/posts/hash",
            snippet="RAG demo recognized by peers.",
        )
    ]
    classification = IndustryClassification(
        normalized_industries=["applied ai", "public speaking"],
        projects=[
            TaggedProject(
                repo_full_name="me/rag-agent",
                industries=["applied ai"],
                skill_subtags=["RAG", "Python"],
                summary="Built a retrieval augmented generation agent.",
                quantitative_impact=["Processed 1,000 documents in tests."],
                qualitative_impact=["Component-level retrieval and answer synthesis pipeline."],
            )
        ],
        achievements=[
            TaggedAchievement(
                source_id="0",
                industries=[],
                skill_subtags=["RAG"],
                focused_snippet="RAG demo recognized by peers.",
            )
        ],
    )

    plans = plan_industry_resumes(classification, repos, achievements)

    assert [plan.industry for plan in plans] == ["applied ai"]
    assert plans[0].projects[0].quantitative_impact == ["Processed 1,000 documents in tests."]
    assert plans[0].projects[0].qualitative_impact == [
        "Component-level retrieval and answer synthesis pipeline."
    ]
    assert len(plans[0].achievements) == 1


def test_compact_github_display_is_icon_owner_repo():
    icon, display = compact_source_display("https://github.com/owner/repo", "github")

    assert icon == "github"
    assert display == "github/owner/repo"
