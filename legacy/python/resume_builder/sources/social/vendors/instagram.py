"""Instagram handler via the public web-profile JSON endpoint.

Authenticated requests work best with the `IG_COOKIE` env var (`sessionid=...`).
Without it the JSON endpoint usually 401s; we return [] cleanly.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Iterable

import time

from ..auth import Credentials, LoginError, LoginPrompt, resolve_session_cookies
from ..base import SocialVendor
from ..http import HttpClient
from ..models import SocialMention, SocialPost

log = logging.getLogger(__name__)

_PROFILE = "https://www.instagram.com/api/v1/users/web_profile_info/"
_TAG_SEARCH = "https://www.instagram.com/api/v1/tags/web_info/"


class InstagramVendor(SocialVendor):
    name = "instagram"

    def __init__(self, cookies: dict[str, str] | None = None) -> None:
        resolved = cookies if cookies is not None else resolve_session_cookies("instagram")
        self._client = HttpClient(cookies=resolved)
        self._headers = {"x-ig-app-id": "936619743392459"}
        if not resolved.get("sessionid"):
            log.info("Instagram vendor has no sessionid — likely empty results.")

    def fetch_own_posts(self, handle: str, limit: int = 50) -> list[SocialPost]:
        try:
            resp = self._client.get(_PROFILE, params={"username": handle}, headers=self._headers)
            payload = _safe_json(resp)
        except Exception as exc:  # noqa: BLE001
            log.warning("instagram fetch_own_posts failed: %s", exc)
            return []
        user = ((payload or {}).get("data") or {}).get("user") or {}
        edges = ((user.get("edge_owner_to_timeline_media") or {}).get("edges")) or []
        return list(self._edges_to_posts(edges))[:limit]

    def search_mentions(self, full_name: str, limit: int = 50) -> list[SocialMention]:
        slug = full_name.lower().replace(" ", "")
        try:
            resp = self._client.get(_TAG_SEARCH, params={"tag_name": slug}, headers=self._headers)
            payload = _safe_json(resp)
        except Exception as exc:  # noqa: BLE001
            log.warning("instagram search_mentions failed: %s", exc)
            return []
        sections = ((payload or {}).get("data") or {}).get("top") or {}
        edges = sections.get("sections") or []
        return list(self._sections_to_mentions(edges, full_name))[:limit]

    def _edges_to_posts(self, edges: list[dict]) -> Iterable[SocialPost]:
        for edge in edges:
            node = edge.get("node") or {}
            shortcode = node.get("shortcode") or node.get("code") or ""
            if not shortcode:
                continue
            caption_edges = (node.get("edge_media_to_caption") or {}).get("edges") or []
            caption = (caption_edges[0]["node"].get("text") if caption_edges else "") or ""
            ts = node.get("taken_at_timestamp")
            yield SocialPost(
                vendor=self.name,
                post_id=shortcode,
                url=f"https://www.instagram.com/p/{shortcode}/",
                posted_at=datetime.fromtimestamp(ts, tz=timezone.utc) if ts else None,
                text=caption,
            )

    def _sections_to_mentions(
        self, sections: list[dict], full_name: str
    ) -> Iterable[SocialMention]:
        name_lower = full_name.lower()
        for section in sections:
            medias = ((section.get("layout_content") or {}).get("medias")) or []
            for media in medias:
                m = media.get("media") or {}
                shortcode = m.get("code") or ""
                caption = (m.get("caption") or {}).get("text") or ""
                if not shortcode or name_lower not in caption.lower():
                    continue
                author = (m.get("user") or {}).get("username") or ""
                ts = m.get("taken_at")
                yield SocialMention(
                    vendor=self.name,
                    mention_id=shortcode,
                    url=f"https://www.instagram.com/p/{shortcode}/",
                    posted_at=datetime.fromtimestamp(ts, tz=timezone.utc) if ts else None,
                    text=caption,
                    author_name=author,
                )


class InstagramLogin:
    """Instagram web login. Two-factor returns ``two_factor_required: true`` with
    a ``two_factor_info`` blob whose ``two_factor_identifier`` we echo back with the code.
    """

    _HOME = "https://www.instagram.com/"
    _LOGIN = "https://www.instagram.com/api/v1/web/accounts/login/ajax/"
    _TWO_FACTOR = "https://www.instagram.com/api/v1/web/accounts/login/ajax/two_factor/"

    def __init__(self, client: HttpClient | None = None) -> None:
        self._client = client or HttpClient(min_interval_s=2.0)
        self._app_id = "936619743392459"

    def run(self, creds: Credentials, prompt: LoginPrompt) -> dict[str, str]:
        csrf = self._fetch_csrf()
        enc_password = f"#PWD_INSTAGRAM_BROWSER:0:{int(time.time())}:{creds.password}"
        headers = {
            "x-csrftoken": csrf,
            "x-ig-app-id": self._app_id,
            "x-requested-with": "XMLHttpRequest",
            "referer": self._HOME,
        }
        resp = self._client.post(
            self._LOGIN,
            data={
                "username": creds.username,
                "enc_password": enc_password,
                "queryParams": "{}",
                "optIntoOneTap": "false",
            },
            headers=headers,
        )
        data = _safe_json(resp) or {}
        if data.get("two_factor_required"):
            self._handle_two_factor(data, csrf, prompt)
        elif not data.get("authenticated"):
            msg = data.get("message") or data.get("error_type") or "unknown"
            raise LoginError(f"instagram login: not authenticated ({msg})")
        cookies = self._extract_ig_cookies()
        if "sessionid" not in cookies:
            raise LoginError("instagram login: sessionid cookie missing after auth")
        return cookies

    def _fetch_csrf(self) -> str:
        self._client.get(self._HOME)
        jar = getattr(self._client, "cookies", None) or []
        for c in jar:
            if getattr(c, "name", None) == "csrftoken":
                return getattr(c, "value", "") or ""
        raise LoginError("instagram login: csrftoken cookie missing on home page")

    def _handle_two_factor(self, data: dict, csrf: str, prompt: LoginPrompt) -> None:
        info = data.get("two_factor_info") or {}
        identifier = info.get("two_factor_identifier")
        username = info.get("username")
        if not identifier or not username:
            raise LoginError("instagram login: two_factor_info missing identifier")
        code = prompt.ask("Instagram: enter the 2FA code (authenticator or SMS)")
        headers = {
            "x-csrftoken": csrf,
            "x-ig-app-id": self._app_id,
            "x-requested-with": "XMLHttpRequest",
            "referer": self._HOME,
        }
        resp = self._client.post(
            self._TWO_FACTOR,
            data={
                "username": username,
                "verificationCode": code,
                "identifier": identifier,
                "trust_signal": "true",
            },
            headers=headers,
        )
        result = _safe_json(resp) or {}
        if not result.get("authenticated"):
            raise LoginError("instagram login: 2FA verification rejected")

    def _extract_ig_cookies(self) -> dict[str, str]:
        jar = getattr(self._client, "cookies", None)
        if jar is None:
            return {}
        out: dict[str, str] = {}
        for c in jar:
            name = getattr(c, "name", None)
            value = getattr(c, "value", None)
            if name in ("sessionid", "csrftoken", "ds_user_id") and value:
                out[name] = value
        return out


def login_instagram(creds: Credentials, prompt: LoginPrompt) -> dict[str, str]:
    return InstagramLogin().run(creds, prompt)


def _safe_json(resp: object) -> dict | None:
    text = getattr(resp, "text", None)
    if not text:
        return None
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None
