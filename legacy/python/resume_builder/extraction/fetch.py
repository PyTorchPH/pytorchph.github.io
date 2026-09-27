from __future__ import annotations

import logging
import re
from typing import Callable

import requests

log = logging.getLogger(__name__)

_UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}
_THIN_TEXT_MIN = 200  # visible-text chars below which we suspect a JS-rendered shell


def _visible_text_len(html: str) -> int:
    return len(re.sub(r"<[^>]+>", " ", html or "").strip())


def _default_get(url: str) -> str:
    try:
        resp = requests.get(url, headers=_UA, timeout=20)
        resp.raise_for_status()
        return resp.text
    except Exception as exc:  # noqa: BLE001 — network failure degrades, never raises
        log.warning("static fetch failed for %s: %s", url, exc)
        return ""


class SourceFetcher:
    """Static-first fetch with a headless fallback for thin/JS-rendered pages."""

    def __init__(
        self,
        headless_fetch: Callable[[str], str] | None = None,
        http_get: Callable[[str], str] | None = None,
    ) -> None:
        self._headless = headless_fetch
        self._get = http_get or _default_get

    def fetch(self, url: str) -> tuple[str, bool]:
        try:
            html = self._get(url)
        except Exception as exc:  # noqa: BLE001 — any get() failure degrades, never raises
            log.warning("fetch get() raised for %s: %s", url, exc)
            html = ""
        if _visible_text_len(html) >= _THIN_TEXT_MIN:
            return html, False
        if self._headless is not None:
            try:
                rendered = self._headless(url)
            except Exception as exc:  # noqa: BLE001
                log.warning("headless fetch failed for %s: %s", url, exc)
                rendered = ""
            if _visible_text_len(rendered) > _visible_text_len(html):
                return rendered, True
        return html, True
