from __future__ import annotations

import base64
import json
import subprocess
from unittest.mock import patch

import pytest

from resume_builder.sources.github import GitHubSource


def _mock_run(stdout_payload: dict | list) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(
        args=["gh"], returncode=0, stdout=json.dumps(stdout_payload), stderr=""
    )


@pytest.fixture
def gh_source(monkeypatch):
    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/gh")
    return GitHubSource(backend="cli")


def test_collect_normalizes_repos(gh_source):
    repo_list = [
        {
            "name": "soc-playbook",
            "nameWithOwner": "me/soc-playbook",
            "url": "https://github.com/me/soc-playbook",
            "description": "SIEM detection playbook",
            "primaryLanguage": {"name": "Python"},
            "languages": [{"node": {"name": "Python"}}, {"node": {"name": "YAML"}}],
            "repositoryTopics": [{"name": "security"}, {"name": "siem"}],
            "stargazerCount": 12,
            "isArchived": False,
        }
    ]
    readme_payload = {
        "content": base64.b64encode(b"# soc-playbook\nSplunk + Sigma rules.").decode()
    }
    with patch("subprocess.run") as run:
        run.side_effect = [_mock_run(repo_list), _mock_run(readme_payload)]
        repos = gh_source.collect("me", limit=5, include_readme=True)
    assert len(repos) == 1
    repo = repos[0]
    assert repo.full_name == "me/soc-playbook"
    assert "Python" in repo.languages
    assert "siem" in repo.topics
    assert "Sigma" in (repo.readme or "")
    assert repo.stars == 12
