"""User-agnostic GitHub collection from public web pages by default.

The optional ``cli`` backend is a developer convenience. Product behavior uses the
normal GitHub website and does not require an authenticated ``gh`` installation.
"""

from __future__ import annotations

import base64
import json
import logging
import shutil
import subprocess
from typing import Any
from urllib.parse import quote, urljoin

import lxml.html
import requests

from ..core.models import Repo
from .base import SourceCollector

log = logging.getLogger(__name__)

_REPO_FIELDS = "name,nameWithOwner,url,description,primaryLanguage,languages,repositoryTopics,stargazerCount,isArchived"


class GitHubCliNotFoundError(RuntimeError):
    pass


class GitHubAccessBlockedError(RuntimeError):
    pass


class GitHubSource(SourceCollector):
    name = "github"

    def __init__(
        self,
        gh_binary: str = "gh",
        *,
        backend: str = "website",
        session: Any | None = None,
    ) -> None:
        if backend not in {"website", "cli"}:
            raise ValueError("GitHub backend must be 'website' or 'cli'")
        if backend == "cli" and shutil.which(gh_binary) is None:
            raise GitHubCliNotFoundError(
                f"`{gh_binary}` CLI not found on PATH. Install it from https://cli.github.com/"
            )
        self._gh = gh_binary
        self.backend = backend
        self._session = session or requests.Session()
        self._session.headers.update(
            {
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
                ),
            }
        )

    def collect(self, user: str, limit: int = 100, include_readme: bool = True) -> list[Repo]:
        """Collect repositories for the runtime-provided username or organization."""

        if not user or not user.strip():
            raise ValueError("GitHub username/org must come from runtime input and cannot be blank")
        user = user.strip()
        raw = (
            self._list_repos_web(user, limit=limit)
            if self.backend == "website"
            else self._list_repos_cli(user, limit=limit)
        )
        repos = [self._normalize_repo(item) for item in raw]
        if include_readme:
            for repo in repos:
                repo.readme = (
                    self._fetch_readme_web(repo.full_name)
                    if self.backend == "website"
                    else self._fetch_readme_cli(repo.full_name)
                )
        return repos

    # ------- default website backend -------

    def _get_html(self, url: str) -> str:
        response = self._session.get(url, timeout=25)
        body = response.text or ""
        lowered = body.lower()
        if response.status_code in {403, 429} or any(
            marker in lowered
            for marker in (
                "<title>additional verification required",
                "<title>verify you are human",
                "<title>rate limit exceeded",
            )
        ):
            raise GitHubAccessBlockedError(
                f"GitHub access gate blocked {url} (status={response.status_code}); "
                "human handoff required"
            )
        response.raise_for_status()
        return body

    def _list_repos_web(self, user: str, limit: int) -> list[dict]:
        profile_url = f"https://github.com/{quote(user)}?tab=repositories&per_page=100"
        root = lxml.html.fromstring(self._get_html(profile_url))
        rows: list[dict] = []
        for item in root.xpath("//li[@itemprop='owns']"):
            links = item.xpath(".//a[@itemprop='name codeRepository']")
            if not links:
                links = item.xpath(".//h3//a[contains(@href, '/')]")
            if not links:
                continue
            href = links[0].get("href") or ""
            full_name = href.strip("/")
            description = " ".join(item.xpath(".//*[@itemprop='description']//text()"))
            language = " ".join(item.xpath(".//*[@itemprop='programmingLanguage']//text()")).strip()
            rows.append(
                {
                    "name": full_name.split("/")[-1],
                    "nameWithOwner": full_name,
                    "url": urljoin("https://github.com", href),
                    "description": " ".join(description.split()) or None,
                    "languages": [language] if language else [],
                    "repositoryTopics": [],
                    "stargazerCount": 0,
                    "isArchived": False,
                }
            )
            if len(rows) >= limit:
                break
        return rows

    def _fetch_readme_web(self, full_name: str) -> str | None:
        try:
            root = lxml.html.fromstring(self._get_html(f"https://github.com/{full_name}"))
        except (requests.RequestException, GitHubAccessBlockedError, ValueError):
            return None
        articles = root.xpath(
            "//article[contains(concat(' ', normalize-space(@class), ' '), ' markdown-body ')]"
        )
        if not articles:
            return None
        return "\n".join(
            line.strip() for line in articles[0].text_content().splitlines() if line.strip()
        )

    # ------- optional gh CLI backend -------

    def _gh_json(self, args: list[str]) -> Any:
        try:
            result = subprocess.run(
                [self._gh, *args],
                capture_output=True,
                text=True,
                check=True,
                encoding="utf-8",
            )
        except subprocess.CalledProcessError as exc:
            log.warning("gh command failed: %s | stderr=%s", args, exc.stderr.strip())
            raise
        return json.loads(result.stdout) if result.stdout.strip() else None

    def _list_repos_cli(self, user: str, limit: int) -> list[dict]:
        return self._gh_json(
            ["repo", "list", user, "--limit", str(limit), "--json", _REPO_FIELDS]
        ) or []

    def _fetch_readme_cli(self, full_name: str) -> str | None:
        try:
            data = self._gh_json(["api", f"repos/{full_name}/readme"])
        except subprocess.CalledProcessError:
            return None
        if not data or "content" not in data:
            return None
        try:
            return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _normalize_repo(raw: dict) -> Repo:
        languages = raw.get("languages") or []
        if languages and isinstance(languages[0], dict):
            languages = [lang.get("node", {}).get("name") or lang.get("name") for lang in languages]
        languages = [language for language in languages if language]
        primary = raw.get("primaryLanguage")
        if primary and isinstance(primary, dict):
            primary_name = primary.get("name")
            if primary_name and primary_name not in languages:
                languages.insert(0, primary_name)
        topics_raw = raw.get("repositoryTopics") or []
        topics = [topic.get("name") if isinstance(topic, dict) else topic for topic in topics_raw]
        return Repo(
            name=raw.get("name", ""),
            full_name=raw.get("nameWithOwner") or raw.get("name", ""),
            url=raw.get("url", ""),
            description=raw.get("description"),
            languages=languages,
            topics=[topic for topic in topics if topic],
            stars=raw.get("stargazerCount") or 0,
            archived=bool(raw.get("isArchived")),
        )
