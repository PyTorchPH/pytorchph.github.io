from __future__ import annotations

from resume_builder.classification.industry import IndustryClassification, TaggedProject
from resume_builder.interpretation.models import UserProfile
from resume_builder.interpretation.profile import ProfileSink, build_user_profile


def test_build_user_profile_collects_skills_and_industries_only():
    cls = IndustryClassification(
        normalized_industries=["artificial intelligence", "web development"],
        projects=[TaggedProject(repo_full_name="a", industries=["artificial intelligence"],
                                skill_subtags=["Python", "PyTorch"])],
    )
    prof = build_user_profile(cls)
    assert set(prof.industries) == {"artificial intelligence", "web development"}
    assert set(prof.skills) == {"Python", "PyTorch"}


def test_profile_sink_writes_json(tmp_path):
    path = ProfileSink(tmp_path).save(UserProfile(skills=["Python"], industries=["ai"]))
    assert path.exists() and "Python" in path.read_text(encoding="utf-8")
