from __future__ import annotations

from typing import Callable

DomainFallback = Callable[[str, str], str]


def _facebook(url: str, html: str) -> str:
    from ..sources.social.vendors.facebook import FacebookVendor

    posts = FacebookVendor._parse_rendered_posts(html, url)
    return "\n".join(post.text for post in posts)


def _linkedin(url: str, html: str) -> str:
    from ..sources.social.vendors.linkedin import LinkedInVendor

    vendor = LinkedInVendor(cookies={})
    return "\n".join(post.text for post in vendor._parse_posts(html))


def build_default_domain_fallbacks() -> dict[str, DomainFallback]:
    """Adapters over the pre-existing hardcoded scrapers; used only after AI/readability."""
    return {
        "facebook.com": _facebook,
        "www.facebook.com": _facebook,
        "m.facebook.com": _facebook,
        "linkedin.com": _linkedin,
        "www.linkedin.com": _linkedin,
    }

