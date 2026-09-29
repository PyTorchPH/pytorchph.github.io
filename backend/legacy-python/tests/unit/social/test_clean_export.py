"""The CLEAN per-vendor export must contain ONLY the fields the user wants.

Contract under test:
- exactly {url, posted_at, text, media_urls} per post — no vendor, no engagement, no post_id.
- one file per vendor; the filename marks the vendor (no vendor field inside).
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


from resume_builder.sources.social.clean_export import (
    CLEAN_POST_FIELDS,
    clean_post,
    write_clean_per_vendor,
)
from resume_builder.sources.social.models import SocialPost

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "social"


def _fb_posts() -> list[SocialPost]:
    return [
        SocialPost(
            vendor="facebook",
            post_id="1234567890",
            url="https://www.facebook.com/feutechpytorch/posts/1234567890",
            posted_at=datetime(2026, 3, 14, 9, 30, 0),
            text="Spoke at the FEU Tech PyTorch chapter on training CNNs from scratch.",
            media_urls=("https://scontent.fmnl.example/image1.jpg",),
            engagement={"reactions": 42, "comments": 7, "shares": 3},
        ),
        SocialPost(
            vendor="facebook",
            post_id="1234567891",
            url="https://www.facebook.com/feutechpytorch/posts/1234567891",
            posted_at=datetime(2026, 2, 1, 14, 0, 0),
            text="Won 2nd place at the inter-university CTF representing FEU Tech.",
            media_urls=(),
            engagement={"reactions": 120},
        ),
    ]


def test_clean_post_keeps_exactly_the_wanted_fields():
    cleaned = clean_post(_fb_posts()[0])
    assert set(cleaned) == set(CLEAN_POST_FIELDS)
    # explicit guards for the fields the user dropped
    assert "engagement" not in cleaned
    assert "vendor" not in cleaned
    assert "post_id" not in cleaned


def test_clean_post_preserves_values():
    cleaned = clean_post(_fb_posts()[0])
    assert cleaned["text"].startswith("Spoke at the FEU Tech")
    assert cleaned["posted_at"] == "2026-03-14T09:30:00"
    assert cleaned["media_urls"] == ["https://scontent.fmnl.example/image1.jpg"]


def test_write_per_vendor_creates_one_file_per_vendor(tmp_path: Path):
    posts = _fb_posts() + [
        SocialPost(
            vendor="linkedin",
            post_id="li-1",
            url="https://www.linkedin.com/posts/li-1",
            posted_at=datetime(2026, 1, 5, 8, 0, 0),
            text="Published a write-up on PyTorch autograd internals.",
        )
    ]
    written = write_clean_per_vendor(posts, tmp_path)

    assert set(written) == {"facebook", "linkedin"}
    assert (tmp_path / "facebook.json").exists()
    assert (tmp_path / "linkedin.json").exists()

    fb = json.loads((tmp_path / "facebook.json").read_text(encoding="utf-8"))
    assert len(fb) == 2
    for post in fb:
        assert set(post) == set(CLEAN_POST_FIELDS)


def test_output_matches_committed_fixture(tmp_path: Path):
    write_clean_per_vendor(_fb_posts(), tmp_path)
    produced = json.loads((tmp_path / "facebook.json").read_text(encoding="utf-8"))
    expected = json.loads((FIXTURES / "clean" / "facebook.json").read_text(encoding="utf-8"))
    assert produced == expected


def test_committed_fixture_has_no_forbidden_fields():
    """Guards the fixture itself from drifting back to vendor/engagement."""
    posts = json.loads((FIXTURES / "clean" / "facebook.json").read_text(encoding="utf-8"))
    for post in posts:
        assert "engagement" not in post
        assert "vendor" not in post
        assert set(post) == set(CLEAN_POST_FIELDS)
