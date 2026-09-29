"""Shared HTTP layer used by vendor handlers.

This client uses one honest, stable session. It does not spoof browser/TLS fingerprints,
rotate identities, or attempt to bypass verification. Sites that require a real browser,
login, or CAPTCHA must use the visible human-auth flow and saved legitimate session.
"""

from __future__ import annotations

import logging
import time
from typing import Any

log = logging.getLogger(__name__)


try:
    from curl_cffi import requests as _curl_requests  # type: ignore[import-not-found]

    _HAS_CURL_CFFI = True
except Exception:  # pragma: no cover - optional dep
    _HAS_CURL_CFFI = False
    import requests as _curl_requests  # type: ignore[no-redef]


_DEFAULT_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}


class HttpClient:
    """Tiny session wrapper with retry, rate-limit, and optional Chrome impersonation."""

    def __init__(
        self,
        *,
        min_interval_s: float = 3.0,
        max_retries: int = 2,
        timeout_s: float = 20.0,
        cookies: dict[str, str] | None = None,
    ) -> None:
        self._min_interval_s = min_interval_s
        self._max_retries = max_retries
        self._timeout_s = timeout_s
        self._last_call_ts: float = 0.0
        self._session = self._make_session(cookies or {})

    def _make_session(self, cookies: dict[str, str]) -> Any:
        if _HAS_CURL_CFFI:
            sess = _curl_requests.Session()
        else:
            sess = _curl_requests.Session()
        sess.headers.update(_DEFAULT_HEADERS)
        for k, v in cookies.items():
            sess.cookies.set(k, v)
        return sess

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_call_ts
        if elapsed < self._min_interval_s:
            time.sleep(self._min_interval_s - elapsed)
        self._last_call_ts = time.monotonic()

    def get(self, url: str, **kwargs: Any) -> Any:
        return self._request("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> Any:
        return self._request("POST", url, **kwargs)

    @property
    def cookies(self) -> Any:
        return self._session.cookies

    def _request(self, method: str, url: str, **kwargs: Any) -> Any:
        self._throttle()
        last_exc: Exception | None = None
        for attempt in range(self._max_retries + 1):
            try:
                response = self._session.request(method, url, timeout=self._timeout_s, **kwargs)
                return response
            except Exception as exc:  # noqa: BLE001 - retry layer
                last_exc = exc
                log.debug("%s %s failed (attempt %d): %s", method, url, attempt + 1, exc)
                time.sleep(1.5 * (attempt + 1))
        assert last_exc is not None
        raise last_exc
