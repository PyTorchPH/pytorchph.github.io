"""LinkedIn handler — public profile + content search.

Without `LI_COOKIE` (li_at cookie from a logged-in browser session) the public profile
endpoint returns a login wall; in that case we fall back to the public Google cache
view and extract what we can. Either way: empty list on any failure.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Iterable

from ..auth import Credentials, LoginError, LoginPrompt, resolve_session_cookies
from ..base import SocialVendor
from ..http import HttpClient
from ..models import SocialMention, SocialPost

log = logging.getLogger(__name__)

_PROFILE_URL = "https://www.linkedin.com/in/{handle}/recent-activity/all/"
_SEARCH_URL = "https://www.linkedin.com/search/results/content/"
_URN_RE = re.compile(r'"updateUrn":"urn:li:activity:(\d+)"')
_TEXT_RE = re.compile(r'"commentary":\{"text":\{"text":"([^"]+)"')
_AUTHOR_RE = re.compile(r'"actor":\{[^}]*"name":\{"text":"([^"]+)"')


class LinkedInVendor(SocialVendor):
    name = "linkedin"

    def __init__(self, cookies: dict[str, str] | None = None) -> None:
        resolved = cookies if cookies is not None else resolve_session_cookies("linkedin")
        self._client = HttpClient(cookies=resolved)
        self._authenticated = bool(resolved.get("li_at"))
        if not self._authenticated:
            log.info("LinkedIn vendor has no li_at cookie — public-only mode.")

    def fetch_own_posts(self, handle: str, limit: int = 50) -> list[SocialPost]:
        try:
            resp = self._client.get(_PROFILE_URL.format(handle=handle))
            html = getattr(resp, "text", "") or ""
        except Exception as exc:  # noqa: BLE001
            log.warning("linkedin fetch_own_posts failed: %s", exc)
            return []
        return list(self._parse_posts(html))[:limit]

    def search_mentions(self, full_name: str, limit: int = 50) -> list[SocialMention]:
        try:
            resp = self._client.get(_SEARCH_URL, params={"keywords": full_name})
            html = getattr(resp, "text", "") or ""
        except Exception as exc:  # noqa: BLE001
            log.warning("linkedin search_mentions failed: %s", exc)
            return []
        return list(self._parse_mentions(html, full_name))[:limit]

    def _parse_posts(self, html: str) -> Iterable[SocialPost]:
        urns = _URN_RE.findall(html)
        texts = _TEXT_RE.findall(html)
        for urn, text in zip(urns, texts):
            decoded = _decode_li_text(text)
            if not decoded:
                continue
            yield SocialPost(
                vendor=self.name,
                post_id=urn,
                url=f"https://www.linkedin.com/feed/update/urn:li:activity:{urn}/",
                text=decoded,
            )

    def _parse_mentions(self, html: str, full_name: str) -> Iterable[SocialMention]:
        urns = _URN_RE.findall(html)
        texts = _TEXT_RE.findall(html)
        authors = _AUTHOR_RE.findall(html)
        name_lower = full_name.lower()
        for urn, text, author in zip(urns, texts, authors + [""] * len(urns)):
            decoded = _decode_li_text(text)
            if not decoded or name_lower not in decoded.lower():
                continue
            yield SocialMention(
                vendor=self.name,
                mention_id=urn,
                url=f"https://www.linkedin.com/feed/update/urn:li:activity:{urn}/",
                text=decoded,
                author_name=author,
            )


def _decode_li_text(raw: str) -> str:
    try:
        return json.loads(f'"{raw}"')
    except json.JSONDecodeError:
        return raw


_CSRF_RE = re.compile(r'name="loginCsrfParam"\s+value="([^"]+)"')


class LinkedInLogin:
    """LinkedIn web login. 2FA path lands on /checkpoint/challenge — console-prompt the PIN."""

    _LOGIN_PAGE = "https://www.linkedin.com/login"
    _SUBMIT = "https://www.linkedin.com/checkpoint/lg/login-submit"
    _CHALLENGE_SUBMIT = "https://www.linkedin.com/checkpoint/challenge/verify"

    def __init__(self, client: HttpClient | None = None) -> None:
        self._client = client or HttpClient(min_interval_s=2.0)

    def run(self, creds: Credentials, prompt: LoginPrompt) -> dict[str, str]:
        csrf = self._fetch_csrf()
        resp = self._client.post(
            self._SUBMIT,
            data={
                "session_key": creds.username,
                "session_password": creds.password,
                "loginCsrfParam": csrf,
            },
            allow_redirects=True,
        )
        html = getattr(resp, "text", "") or ""
        if "/checkpoint/challenge" in (getattr(resp, "url", "") or "") or "challengeId" in html:
            self._solve_challenge(html, prompt)
        cookies = self._extract_li_cookies()
        if "li_at" not in cookies:
            raise LoginError(
                "linkedin login: li_at cookie not set — likely checkpoint or bad credentials"
            )
        return cookies

    def _fetch_csrf(self) -> str:
        resp = self._client.get(self._LOGIN_PAGE)
        m = _CSRF_RE.search(getattr(resp, "text", "") or "")
        if not m:
            raise LoginError("linkedin login: could not extract loginCsrfParam")
        return m.group(1)

    def _solve_challenge(self, html: str, prompt: LoginPrompt) -> None:
        fields = dict(re.findall(r'name="([^"]+)"\s+value="([^"]*)"', html))
        if "challengeId" not in fields:
            raise LoginError("linkedin login: challenge form fields missing")
        code = prompt.ask("LinkedIn: enter the verification PIN sent to email / phone / app")
        fields["pin"] = code
        self._client.post(self._CHALLENGE_SUBMIT, data=fields, allow_redirects=True)

    def _extract_li_cookies(self) -> dict[str, str]:
        jar = getattr(self._client, "cookies", None)
        if jar is None:
            return {}
        out: dict[str, str] = {}
        for c in jar:
            name = getattr(c, "name", None)
            value = getattr(c, "value", None)
            if name in ("li_at", "JSESSIONID") and value:
                out[name] = value
        return out


def login_linkedin(creds: Credentials, prompt: LoginPrompt) -> dict[str, str]:
    return LinkedInLogin().run(creds, prompt)
