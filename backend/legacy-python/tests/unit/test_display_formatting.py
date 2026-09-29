from resume_builder.renderers.formatting import compact_skills
from resume_builder.renderers.formatting import plan_skill_layout
from resume_builder.core.models import ResumeSkillGroup


def test_compact_skills_groups_known_frameworks_under_language():
    assert compact_skills(["SQL", "ReactJS", "JavaScript", "Vue", "Docker"]) == [
        "SQL",
        "JavaScript (ReactJS, Vue)",
        "Docker",
    ]


def test_compact_skills_preserves_unrelated_skills_and_source_list():
    source = ["Python", "FastAPI", "Go", "Kubernetes"]
    assert compact_skills(source) == ["Python (FastAPI)", "Go", "Kubernetes"]
    assert source == ["Python", "FastAPI", "Go", "Kubernetes"]


def test_skill_layout_uses_content_and_available_width_for_columns():
    groups = [
        ResumeSkillGroup(name="Python", items=["PyTorch", "FastAPI"]),
        ResumeSkillGroup(name="TypeScript", items=["React", "Next.js"]),
        ResumeSkillGroup(name="C++", items=["CMake"]),
    ]
    assert plan_skill_layout(groups, available_width_px=688).columns == 3
    assert plan_skill_layout(groups, available_width_px=340).columns == 2
    assert plan_skill_layout(groups, available_width_px=169).columns == 1
