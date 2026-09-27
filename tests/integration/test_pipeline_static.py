"""End-to-end static pipeline — no network, no LLM, mocks gh subprocess."""

from __future__ import annotations

import base64
import json
import subprocess
from pathlib import Path
from unittest.mock import patch

from resume_builder.core.config import get_settings
from resume_builder.core.models import Mode
from resume_builder.orchestration.pipeline import BuildInputs, Pipeline


def _gh_response(payload: object) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(
        args=["gh"], returncode=0, stdout=json.dumps(payload), stderr=""
    )


def test_full_static_pipeline(tmp_path: Path, project_root: Path, monkeypatch):
    monkeypatch.chdir(project_root)
    monkeypatch.setenv("RESUME_GITHUB_SOURCE", "cli")
    monkeypatch.setattr("shutil.which", lambda binary: f"/usr/bin/{binary}" if binary == "gh" else None)
    get_settings.cache_clear()  # type: ignore[attr-defined]

    repo_list = [
        {
            "name": "soc-playbook",
            "nameWithOwner": "me/soc-playbook",
            "url": "https://github.com/me/soc-playbook",
            "description": "SOC playbook with Splunk + Sigma rules",
            "primaryLanguage": {"name": "Python"},
            "languages": [{"node": {"name": "Python"}}],
            "repositoryTopics": [{"name": "security"}, {"name": "siem"}],
            "stargazerCount": 5,
            "isArchived": False,
        },
        {
            "name": "recipes",
            "nameWithOwner": "me/recipes",
            "url": "https://github.com/me/recipes",
            "description": "Pasta recipes",
            "primaryLanguage": {"name": "JavaScript"},
            "languages": [{"node": {"name": "JavaScript"}}],
            "repositoryTopics": [{"name": "food"}],
            "stargazerCount": 0,
            "isArchived": False,
        },
    ]
    readme_soc = {"content": base64.b64encode(b"Detection engineering, SIEM, incident response.").decode()}
    readme_recipes = {"content": base64.b64encode(b"Carbonara recipe.").decode()}

    docs_file = tmp_path / "resume.tex"
    docs_file.write_text(
        r"""
\name{Drew}
Email: drew@example.com
\section{Experience}
SOC Engineer at Acme
- Built detection pipeline

\section{Education}
University of Example
""",
        encoding="utf-8",
    )

    out_dir = tmp_path / "out"

    with patch("subprocess.run") as run:
        run.side_effect = [
            _gh_response(repo_list),
            _gh_response(readme_soc),
            _gh_response(readme_recipes),
        ]
        pipeline = Pipeline(mode=Mode.STATIC)
        result = pipeline.run(
            BuildInputs(
                gh_user="me",
                role_selection="cybersecurity-blueteam",
                docs_path=docs_file,
                formats=["json", "md", "latex"],
                output_dir=out_dir,
            )
        )

    project_names = [p.name for p in result.resume.projects]
    assert "soc-playbook" in project_names
    assert "recipes" not in project_names
    assert result.resume.contact.email == "drew@example.com"
    assert (out_dir / "resume.json").exists()
    assert (out_dir / "resume.md").exists()
    assert (out_dir / "resume.tex").exists()

    parsed = json.loads((out_dir / "resume.json").read_text(encoding="utf-8"))
    assert parsed["role"]["id"] == "cybersecurity-blueteam"


def test_projects_filtered_by_role_static():
    from resume_builder.core.models import ResumeProject, RoleSpec
    from resume_builder.orchestration import pipeline as P

    role = RoleSpec(id="ml-engineer", label="ML", keywords=["pytorch", "LLM"],
                    must_have_skills=["python"], nice_to_have=[])
    projects = [
        ResumeProject(name="MusicScanIter", description="PyTorch model trainer", tech=["Python"]),
        ResumeProject(name="Andrew-mini-compiler", description="A C++ compiler", tech=["C++"]),
    ]
    kept = P._filter_projects_by_role(projects, role, llm=None)
    assert "Andrew-mini-compiler" not in [p.name for p in kept]
