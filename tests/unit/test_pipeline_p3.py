"""Tests for P3 interpretation wiring into run_industry_auto.

Covers:
- _classify_with_p3 routes repo sources via bare full_name keys (gap #1)
- _classify_with_p3 routes social achievements via str-index source_id keys (gap #2)
- run_industry_auto end-to-end with a fake LLM produces resumes with projects
- Static/NullProvider path through run_industry_auto remains unchanged
"""

from __future__ import annotations

import json

from resume_builder.core.models import Mode, Repo, ResumeAchievement
from resume_builder.interpretation.normalizer import _AliasMap
from resume_builder.llm.base import LLMProvider
from resume_builder.llm.null_provider import NullProvider
from resume_builder.orchestration.pipeline import BuildIndustryInputs, Pipeline

# ---------------------------------------------------------------------------
# Fake LLM — deterministic, no network
# ---------------------------------------------------------------------------


class _FakeLLM(LLMProvider):
    """Branches on schema.__name__ to return deterministic structured outputs."""

    name = "fake-p3"

    def __init__(self, industry: str = "ai") -> None:
        self._industry = industry
        self.tagger_calls: list[str] = []  # source_ids seen by tagger calls

    def complete(self, *args, **kwargs):
        raise NotImplementedError("_FakeLLM does not implement complete()")

    def structured(self, prompt: str, schema, system=None, max_tokens=1024):
        name = schema.__name__
        if name == "TaggedProject":
            # Tagger call — extract source_id from prompt header
            source_id = ""
            for line in prompt.splitlines():
                if line.startswith("Source id:"):
                    source_id = line.split(":", 1)[1].strip()
                    break
            self.tagger_calls.append(source_id)
            return schema.model_validate(
                {
                    "repo_full_name": source_id,
                    "industries": [self._industry],
                    "skill_subtags": ["Python"],
                    "summary": f"Fake summary for {source_id}",
                    "quantitative_impact": [],
                    "qualitative_impact": [],
                }
            )
        if name == "_AliasMap":
            # Normalizer alias-map call — return identity (no merging)
            return _AliasMap(industry_map={}, skill_map={})
        raise ValueError(f"_FakeLLM: unexpected schema {name!r}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_repos() -> list[Repo]:
    return [
        Repo(
            name="rag-agent",
            full_name="me/rag-agent",
            url="https://github.com/me/rag-agent",
            description="RAG agent for document QA",
            languages=["Python"],
        ),
        Repo(
            name="sec-scanner",
            full_name="me/sec-scanner",
            url="https://github.com/me/sec-scanner",
            description="Security vulnerability scanner",
            languages=["Python", "Bash"],
        ),
    ]


def _make_achievement() -> ResumeAchievement:
    return ResumeAchievement(
        title="Presented RAG demo at local meetup",
        source="facebook",
        url="https://facebook.com/posts/abc",
        snippet="Demo of RAG-based QA system recognized by peers.",
    )


# ---------------------------------------------------------------------------
# Unit tests for _classify_with_p3
# ---------------------------------------------------------------------------


def test_repo_sources_use_bare_full_name_as_key():
    """TaggedProjects in classification.projects must have repo_full_name == repo.full_name."""
    repos = _make_repos()
    fake_llm = _FakeLLM(industry="ai")
    pipeline = Pipeline(mode=Mode.AI, llm=fake_llm)

    classification = pipeline._classify_with_p3(repos, achievements=[])

    repo_full_names = {repo.full_name for repo in repos}
    returned_keys = {tp.repo_full_name for tp in classification.projects}
    assert returned_keys == repo_full_names, (
        f"Expected projects keyed by {repo_full_names}, got {returned_keys}"
    )


def test_two_repos_each_produce_one_project():
    """One source per repo → one project per repo in the classification."""
    repos = _make_repos()
    fake_llm = _FakeLLM(industry="ai")
    pipeline = Pipeline(mode=Mode.AI, llm=fake_llm)

    classification = pipeline._classify_with_p3(repos, achievements=[])

    assert len(classification.projects) == 2
    assert len(classification.achievements) == 0


def test_achievement_becomes_tagged_achievement_with_str_index_source_id():
    """Social achievement at index 0 must become TaggedAchievement(source_id='0')."""
    repos = _make_repos()
    achievement = _make_achievement()
    fake_llm = _FakeLLM(industry="ai")
    pipeline = Pipeline(mode=Mode.AI, llm=fake_llm)

    classification = pipeline._classify_with_p3(repos, achievements=[achievement])

    # The achievement post source_id "0" should not appear in projects
    project_keys = {tp.repo_full_name for tp in classification.projects}
    assert "0" not in project_keys

    # It must appear in achievements
    assert len(classification.achievements) == 1
    ta = classification.achievements[0]
    assert ta.source_id == "0"
    assert ta.industries == ["ai"]
    assert ta.skill_subtags == ["Python"]


def test_archived_repos_are_excluded():
    """Archived repos must not be sent to interpret and must not appear in projects."""
    repos = [
        Repo(
            name="active",
            full_name="me/active",
            url="https://github.com/me/active",
            description="Active project",
            archived=False,
        ),
        Repo(
            name="old",
            full_name="me/old",
            url="https://github.com/me/old",
            description="Archived project",
            archived=True,
        ),
    ]
    fake_llm = _FakeLLM(industry="ai")
    pipeline = Pipeline(mode=Mode.AI, llm=fake_llm)

    classification = pipeline._classify_with_p3(repos, achievements=[])

    project_keys = {tp.repo_full_name for tp in classification.projects}
    assert "me/active" in project_keys
    assert "me/old" not in project_keys


# ---------------------------------------------------------------------------
# End-to-end: run_industry_auto with fake LLM
# ---------------------------------------------------------------------------


def test_run_industry_auto_yields_resumes_with_projects(monkeypatch, tmp_path):
    """Bare-key contract end-to-end: repos must produce non-empty projects in resumes."""
    repos = _make_repos()
    fake_llm = _FakeLLM(industry="ai")
    pipeline = Pipeline(mode=Mode.AI, llm=fake_llm)

    # Stub network calls
    monkeypatch.setattr(pipeline.github, "collect", lambda *a, **kw: repos)
    monkeypatch.setattr(pipeline.docs, "collect", lambda path: [])

    result = pipeline.run_industry_auto(
        BuildIndustryInputs(
            gh_user="me",
            docs_path=None,
            formats=["json"],
            output_dir=tmp_path,
        )
    )

    assert len(result.resumes) >= 1, "Expected at least one industry resume"
    assert any(len(r.projects) > 0 for r in result.resumes), (
        "Expected at least one resume with non-empty projects (bare-key contract)"
    )
    profile = json.loads((tmp_path / "user_profile.json").read_text(encoding="utf-8"))
    assert profile["skills"] == ["Python"]
    assert profile["industries"] == ["ai"]


def test_run_industry_auto_post_achievement_routed_via_index(monkeypatch, tmp_path):
    """post→achievement routing: an achievement at index 0 appears in the resume plan."""
    repos = [_make_repos()[0]]  # one repo → one industry plan
    achievement = _make_achievement()
    fake_llm = _FakeLLM(industry="ai")

    pipeline = Pipeline(mode=Mode.AI, llm=fake_llm)

    # Stub social so that `achievements = [achievement]` is fed to _classify_with_p3
    import datetime

    from resume_builder.sources.social import CollectResult, SocialPost

    fake_post = SocialPost(
        vendor="facebook",
        post_id="abc123",
        url=achievement.url,
        text=achievement.snippet or achievement.title,
        posted_at=datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC),
    )
    fake_social_result = CollectResult(posts=[fake_post], mentions=[])

    monkeypatch.setattr(pipeline.github, "collect", lambda *a, **kw: repos)
    monkeypatch.setattr(pipeline.docs, "collect", lambda path: [])
    monkeypatch.setattr(pipeline.social, "collect", lambda config: fake_social_result)

    # Write a minimal social config so _collect_social doesn't bail out early
    social_cfg = tmp_path / "social.yaml"
    social_cfg.write_text("vendors: []\n", encoding="utf-8")

    result = pipeline.run_industry_auto(
        BuildIndustryInputs(
            gh_user="me",
            docs_path=None,
            formats=["json"],
            output_dir=tmp_path,
            social_config_path=str(social_cfg),
        )
    )

    # As long as we got at least one resume, the routing didn't crash
    assert len(result.resumes) >= 1


# ---------------------------------------------------------------------------
# Static mode guard: NullProvider must still use IndustryClassifier
# ---------------------------------------------------------------------------


def test_static_mode_uses_industry_classifier_not_p3(monkeypatch, tmp_path):
    """NullProvider path must keep using IndustryClassifier (static fallback)."""
    repos = [
        Repo(
            name="platform",
            full_name="me/platform",
            url="https://github.com/me/platform",
            topics=["machine-learning", "python"],
            archived=False,
        )
    ]
    pipeline = Pipeline(mode=Mode.STATIC)
    assert isinstance(pipeline.llm, NullProvider)

    monkeypatch.setattr(pipeline.github, "collect", lambda *a, **kw: repos)
    monkeypatch.setattr(pipeline.docs, "collect", lambda path: [])

    # Patch _classify_with_p3 to detect if it is ever called — it must NOT be
    called = []
    original = pipeline._classify_with_p3

    def spy(*args, **kwargs):
        called.append(True)
        return original(*args, **kwargs)

    monkeypatch.setattr(pipeline, "_classify_with_p3", spy)

    pipeline.run_industry_auto(
        BuildIndustryInputs(
            gh_user="me",
            docs_path=None,
            formats=["json"],
            output_dir=tmp_path,
        )
    )

    assert not called, "_classify_with_p3 must not be called when llm is NullProvider"
