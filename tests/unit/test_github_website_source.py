from __future__ import annotations

import pytest

from resume_builder.sources.github import GitHubAccessBlockedError, GitHubSource

_PROFILE = """
<ul><li itemprop="owns">
  <h3><a itemprop="name codeRepository" href="/sample-user/project-one">project-one</a></h3>
  <p itemprop="description">A useful project.</p>
  <span itemprop="programmingLanguage">Python</span>
</li></ul>
"""
_REPO = '<article class="markdown-body"><h1>Project One</h1><p>Problem-specific README.</p></article>'


class _Response:
    def __init__(self, text: str, status_code: int = 200):
        self.text = text
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class _Session:
    def __init__(self, blocked: bool = False):
        self.headers = {}
        self.blocked = blocked
        self.urls: list[str] = []

    def get(self, url: str, timeout: int = 25):
        self.urls.append(url)
        if self.blocked:
            return _Response("Additional Verification Required", 403)
        return _Response(_PROFILE if "tab=repositories" in url else _REPO)


def test_website_is_default_and_uses_runtime_username():
    session = _Session()
    source = GitHubSource(session=session)
    repos = source.collect("sample-user")
    assert source.backend == "website"
    assert repos[0].full_name == "sample-user/project-one"
    assert repos[0].languages == ["Python"]
    assert "Problem-specific README" in (repos[0].readme or "")
    assert session.urls[0].startswith("https://github.com/sample-user?")


def test_blank_runtime_username_is_rejected():
    with pytest.raises(ValueError, match="runtime input"):
        GitHubSource(session=_Session()).collect(" ")


def test_access_gate_stops_on_verification_page():
    with pytest.raises(GitHubAccessBlockedError, match="human handoff"):
        GitHubSource(session=_Session(blocked=True)).collect("sample-user")
