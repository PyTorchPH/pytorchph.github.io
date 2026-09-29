"""Local-browser cookie import — the friction-free fallback when programmatic login fails.

Uses ``browser_cookie3`` if installed. The user signs in normally on their machine
(2FA, biometric, password manager all work) and we read the cookie jar that was
written by their browser. No password ever passes through this code.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

log = logging.getLogger(__name__)

# Map vendor -> domain(s) the browser stores cookies under. Twitter is dual-domain
# after the X rebrand: some sessions only carry x.com cookies now.
_DOMAINS: dict[str, tuple[str, ...]] = {
    "facebook": (".facebook.com",),
    "linkedin": (".linkedin.com",),
    "twitter": (".twitter.com", ".x.com"),
    "instagram": (".instagram.com",),
}


@dataclass
class ImportReport:
    cookies: dict[str, str]
    attempts: list[tuple[str, str]]  # [(browser, status), ...]

    @property
    def ok(self) -> bool:
        return bool(self.cookies)


def import_cookies_report(vendor: str, browser: str = "auto") -> ImportReport:
    """Pull cookies for ``vendor`` and return a structured report explaining each attempt."""
    attempts: list[tuple[str, str]] = []
    try:
        import browser_cookie3 as bc  # type: ignore[import-not-found]
    except ImportError:
        attempts.append(("(install)", "browser_cookie3 not installed"))
        return ImportReport(cookies={}, attempts=attempts)

    domains = _DOMAINS.get(vendor)
    if not domains:
        attempts.append(("(vendor)", f"no domain mapping for {vendor}"))
        return ImportReport(cookies={}, attempts=attempts)

    loaders = [
        ("chrome", bc.chrome),
        ("edge", bc.edge),
        ("firefox", bc.firefox),
        ("brave", bc.brave),
        ("opera", bc.opera),
    ]
    if browser != "auto":
        loaders = [(n, fn) for n, fn in loaders if n == browser]

    for name, fn in loaders:
        merged: dict[str, str] = {}
        last_error: str | None = None
        for dom in domains:
            try:
                jar = fn(domain_name=dom.lstrip("."))
                for c in jar:
                    if c.value:
                        merged[c.name] = c.value
            except Exception as exc:  # noqa: BLE001
                last_error = f"{type(exc).__name__}: {exc}"
        if merged:
            attempts.append((name, f"loaded {len(merged)} cookies"))
            return ImportReport(cookies=merged, attempts=attempts)
        attempts.append((name, last_error or "no cookies found"))
    return ImportReport(cookies={}, attempts=attempts)


def import_cookies(vendor: str, browser: str = "auto") -> dict[str, str] | None:
    """Compatibility wrapper: returns the cookie dict or ``None`` if none found."""
    report = import_cookies_report(vendor, browser=browser)
    return report.cookies or None
