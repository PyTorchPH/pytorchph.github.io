"""Clean, per-vendor export of scraped posts — the data the system actually ingests.

The CLEAN output deliberately strips plumbing so each file contains *only* what the user
wants:

- **No ``vendor`` field** — the *file* a post lives in marks its vendor (``facebook.json``,
  ``linkedin.json``, ...). Separation by file = modularity, no redundant per-row label.
- **No ``engagement``** — reaction/comment/share counts are not needed for career data.
- **No ``post_id``** — internal dedupe plumbing.

Only these fields survive, in this order:
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from .models import SocialPost

#: The exact, ordered set of fields a clean post keeps. The test suite asserts the
#: output contains these and nothing else.
CLEAN_POST_FIELDS: tuple[str, ...] = ("url", "posted_at", "text", "media_urls")


def clean_post(post: SocialPost) -> dict:
    """Project a ``SocialPost`` down to the clean, ingest-ready field set."""
    data = post.model_dump(mode="json")
    return {field: data[field] for field in CLEAN_POST_FIELDS}


def clean_posts(posts: Iterable[SocialPost]) -> list[dict]:
    return [clean_post(p) for p in posts]


def group_by_vendor(posts: Iterable[SocialPost]) -> dict[str, list[SocialPost]]:
    """Bucket posts by their vendor so each bucket becomes one file."""
    buckets: dict[str, list[SocialPost]] = {}
    for post in posts:
        buckets.setdefault(post.vendor, []).append(post)
    return buckets


def write_clean_per_vendor(posts: Iterable[SocialPost], out_dir: str | Path) -> dict[str, Path]:
    """Write one ``<vendor>.json`` per vendor under ``out_dir``.

    Each file is a JSON array of clean posts (no vendor field inside — the filename is the
    vendor). Returns a mapping of ``vendor -> written path``.
    """
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}
    for vendor, vendor_posts in group_by_vendor(posts).items():
        path = out_path / f"{vendor}.json"
        payload = clean_posts(vendor_posts)
        path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
        written[vendor] = path
    return written
