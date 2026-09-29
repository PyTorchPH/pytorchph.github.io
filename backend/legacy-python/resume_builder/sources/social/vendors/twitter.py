"""X / Twitter handler via nitter.net RSS — no auth required.

Nitter mirrors are unstable; we cycle through a small list and gracefully return [] if
all are down. `NITTER_HOST` env var lets the user pin a private instance.
"""

from __future__ import annotations

import logging
import os
import re
from email.utils import parsedate_to_datetime
from typing import Iterable

from ..auth import Credentials, LoginError, LoginPrompt, resolve_session_cookies
from ..base import SocialVendor
from ..http import HttpClient
from ..models import SocialMention, SocialPost

log = logging.getLogger(__name__)

_DEFAULT_HOSTS = (
    "https://nitter.net",
    "https://nitter.privacydev.net",
    "https://nitter.poast.org",
)

_ITEM_RE = re.compile(r"<item>(.*?)</item>", re.DOTALL)
_TITLE_RE = re.compile(r"<title><!\[CDATA\[(.*?)\]\]></title>", re.DOTALL)
_LINK_RE = re.compile(r"<link>(.*?)</link>")
_DESC_RE = re.compile(r"<description><!\[CDATA\[(.*?)\]\]></description>", re.DOTALL)
_PUB_RE = re.compile(r"<pubDate>(.*?)</pubDate>")
_AUTHOR_RE = re.compile(r"<dc:creator>(.*?)</dc:creator>")
_TAG_STRIP = re.compile(r"<[^>]+>")
_STATUS_ID_RE = re.compile(r"/status/(\d+)")


class TwitterVendor(SocialVendor):
    name = "twitter"

    def __init__(self, cookies: dict[str, str] | None = None) -> None:
        env_host = os.environ.get("NITTER_HOST", "").strip()
        self._hosts = (env_host,) + _DEFAULT_HOSTS if env_host else _DEFAULT_HOSTS
        # Cookies are optional for nitter, but logged-in Twitter sessions also work
        # for direct x.com endpoints in future expansion. Resolve lazily so tests
        # constructing TwitterVendor() don't pay browser-decryption cost.
        resolved = cookies if cookies is not None else resolve_session_cookies("twitter")
        self._client = HttpClient(min_interval_s=1.5, cookies=resolved)

    def fetch_own_posts(self, handle: str, limit: int = 50) -> list[SocialPost]:
        xml = self._fetch_first(f"/{handle}/rss")
        return list(self._parse_posts(xml))[:limit]

    def search_mentions(self, full_name: str, limit: int = 50) -> list[SocialMention]:
        xml = self._fetch_first(f"/search/rss?f=tweets&q=%22{full_name.replace(' ', '+')}%22")
        return list(self._parse_mentions(xml, full_name))[:limit]

    def _fetch_first(self, path: str) -> str:
        for host in self._hosts:
            url = f"{host}{path}"
            try:
                resp = self._client.get(url)
                text = getattr(resp, "text", "") or ""
                if "<item>" in text:
                    return text
            except Exception as exc:  # noqa: BLE001
                log.debug("nitter %s failed: %s", host, exc)
        return ""

    def _parse_posts(self, xml: str) -> Iterable[SocialPost]:
        for item in _ITEM_RE.findall(xml):
            link_m = _LINK_RE.search(item)
            if not link_m:
                continue
            link = link_m.group(1).strip()
            id_m = _STATUS_ID_RE.search(link)
            if not id_m:
                continue
            text = _extract_text(item)
            yield SocialPost(
                vendor=self.name,
                post_id=id_m.group(1),
                url=link.replace("nitter.net", "x.com"),
                posted_at=_parse_date(item),
                text=text,
            )

    def _parse_mentions(self, xml: str, full_name: str) -> Iterable[SocialMention]:
        name_lower = full_name.lower()
        for item in _ITEM_RE.findall(xml):
            link_m = _LINK_RE.search(item)
            if not link_m:
                continue
            link = link_m.group(1).strip()
            id_m = _STATUS_ID_RE.search(link)
            if not id_m:
                continue
            text = _extract_text(item)
            if name_lower not in text.lower():
                continue
            author_m = _AUTHOR_RE.search(item)
            yield SocialMention(
                vendor=self.name,
                mention_id=id_m.group(1),
                url=link.replace("nitter.net", "x.com"),
                posted_at=_parse_date(item),
                text=text,
                author_name=(author_m.group(1).strip() if author_m else ""),
            )


def _extract_text(item: str) -> str:
    desc_m = _DESC_RE.search(item)
    title_m = _TITLE_RE.search(item)
    raw = (desc_m.group(1) if desc_m else "") or (title_m.group(1) if title_m else "")
    return _TAG_STRIP.sub(" ", raw).strip()


class TwitterLogin:
    """X / Twitter login via the multi-step flow API.

    Step chain (each response echoes a ``flow_token`` we feed back in):
      POST /1.1/onboarding/task.json?flow_name=login    -> LoginJsInstrumentationSubtask
      POST .../task.json (instrumentation ack)          -> LoginEnterUserIdentifierSSO
      POST .../task.json (username)                     -> LoginEnterPassword
      POST .../task.json (password)                     -> LoginAcid | LoginTwoFactor... | LoginSuccess

    Console-promptable 2FA paths:
      LoginAcid                       -> SMS / email code
      LoginTwoFactorAuthChallenge     -> TOTP (authenticator app)
    """

    _BEARER = (
        "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs"
        "%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
    )
    _FLOW_URL = "https://api.twitter.com/1.1/onboarding/task.json"
    _GUEST_URL = "https://api.twitter.com/1.1/guest/activate.json"

    def __init__(self, client: HttpClient | None = None) -> None:
        self._client = client or HttpClient(min_interval_s=1.0)

    def run(self, creds: Credentials, prompt: LoginPrompt) -> dict[str, str]:
        guest_token = self._fetch_guest_token()
        headers = {
            "Authorization": f"Bearer {self._BEARER}",
            "x-guest-token": guest_token,
            "Content-Type": "application/json",
        }

        flow_token, subtasks = self._start_flow(headers)
        for _ in range(8):
            if not subtasks:
                raise LoginError("twitter login: empty subtask list")
            subtask_id = subtasks[0].get("subtask_id", "")
            if subtask_id == "LoginSuccessSubtask":
                return self._extract_cookies()
            payload = self._build_subtask(subtask_id, creds, prompt)
            flow_token, subtasks = self._send(
                flow_token, [payload], headers=headers
            )
        raise LoginError("twitter login: exceeded subtask iterations")

    # ---- internals ----

    def _fetch_guest_token(self) -> str:
        resp = self._client.post(
            self._GUEST_URL,
            headers={"Authorization": f"Bearer {self._BEARER}"},
        )
        data = _safe_json(resp)
        token = (data or {}).get("guest_token")
        if not token:
            raise LoginError("twitter login: could not obtain guest token")
        return token

    def _start_flow(self, headers: dict[str, str]) -> tuple[str, list[dict]]:
        body = {
            "input_flow_data": {
                "flow_context": {
                    "debug_overrides": {},
                    "start_location": {"location": "splash_screen"},
                }
            }
        }
        resp = self._client.post(
            self._FLOW_URL, params={"flow_name": "login"}, headers=headers, json=body
        )
        data = _safe_json(resp) or {}
        return data.get("flow_token", ""), data.get("subtasks", [])

    def _send(
        self, flow_token: str, subtask_inputs: list[dict], *, headers: dict[str, str]
    ) -> tuple[str, list[dict]]:
        body = {"flow_token": flow_token, "subtask_inputs": subtask_inputs}
        resp = self._client.post(self._FLOW_URL, headers=headers, json=body)
        data = _safe_json(resp) or {}
        if "errors" in data:
            raise LoginError(f"twitter login: {data['errors']}")
        return data.get("flow_token", ""), data.get("subtasks", [])

    def _build_subtask(
        self, subtask_id: str, creds: Credentials, prompt: LoginPrompt
    ) -> dict:
        if subtask_id == "LoginJsInstrumentationSubtask":
            return {
                "subtask_id": subtask_id,
                "js_instrumentation": {"response": "{}", "link": "next_link"},
            }
        if subtask_id in ("LoginEnterUserIdentifierSSO", "LoginEnterUserIdentifier"):
            return {
                "subtask_id": subtask_id,
                "settings_list": {
                    "setting_responses": [
                        {
                            "key": "user_identifier",
                            "response_data": {"text_data": {"result": creds.username}},
                        }
                    ],
                    "link": "next_link",
                },
            }
        if subtask_id == "LoginEnterPassword":
            return {
                "subtask_id": subtask_id,
                "enter_password": {"password": creds.password, "link": "next_link"},
            }
        if subtask_id == "LoginAcid":
            code = prompt.ask("Twitter: enter the code sent to SMS or email")
            return {
                "subtask_id": subtask_id,
                "enter_text": {"text": code, "link": "next_link"},
            }
        if subtask_id == "LoginTwoFactorAuthChallenge":
            code = prompt.ask("Twitter: enter 6-digit authenticator code")
            return {
                "subtask_id": subtask_id,
                "enter_text": {"text": code, "link": "next_link"},
            }
        if subtask_id == "AccountDuplicationCheck":
            return {
                "subtask_id": subtask_id,
                "check_logged_in_account": {"link": "AccountDuplicationCheck_false"},
            }
        if subtask_id == "DenyLoginSubtask":
            raise LoginError("twitter login: account locked or denied")
        raise LoginError(f"twitter login: unsupported subtask {subtask_id}")

    def _extract_cookies(self) -> dict[str, str]:
        jar = getattr(self._client, "cookies", None)
        if jar is None:
            return {}
        wanted = ("auth_token", "ct0", "twid")
        out: dict[str, str] = {}
        for c in jar:
            name = getattr(c, "name", None)
            value = getattr(c, "value", None)
            if name in wanted and value:
                out[name] = value
        return out


def _safe_json(resp: object) -> dict | None:
    text = getattr(resp, "text", "") or ""
    try:
        import json as _json

        return _json.loads(text)
    except Exception:  # noqa: BLE001
        return None


def login_twitter(creds: Credentials, prompt: LoginPrompt) -> dict[str, str]:
    return TwitterLogin().run(creds, prompt)


def _parse_date(item: str) -> object | None:
    pub_m = _PUB_RE.search(item)
    if not pub_m:
        return None
    try:
        return parsedate_to_datetime(pub_m.group(1).strip())
    except (TypeError, ValueError):
        return None
