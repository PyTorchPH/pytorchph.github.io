"""FacebookVendor._records_to_posts: permalink-extracted dicts -> SocialPost models.

Posts on modern FB profiles are not role=article; they're detected by permalink anchor
and the caption is read from div[dir=auto]. This covers the dict->model conversion that
filters captionless posts and dedupes by id (the in-page extraction itself is validated
live against a real profile)."""

from __future__ import annotations

from resume_builder.sources.social.vendors.facebook import FacebookVendor


def test_records_to_posts_builds_dedups_and_drops_empty():
    records = [
        {"post_id": "po1", "url": "https://fb/p1", "text": "Built a facial recognition system"},
        {"post_id": "po1", "url": "https://fb/p1b", "text": "duplicate id"},
        {"post_id": "pcb2", "url": "https://fb/p2", "text": ""},          # captionless -> drop
        {"post_id": "", "url": "https://fb/p3", "text": "no id"},          # no id -> drop
        {"post_id": "po3", "url": "https://fb/p3", "text": "Won a CTF"},
    ]

    posts = list(FacebookVendor._records_to_posts(records, profile_url="PROFILE"))

    assert [p.post_id for p in posts] == ["po1", "po3"]
    assert posts[0].text == "Built a facial recognition system"
    assert posts[0].url == "https://fb/p1"
    assert all(p.vendor == "facebook" for p in posts)


def test_records_to_posts_url_falls_back_to_profile():
    posts = list(
        FacebookVendor._records_to_posts(
            [{"post_id": "x", "url": "", "text": "caption"}], profile_url="PROFILE_URL"
        )
    )

    assert posts[0].url == "PROFILE_URL"


def test_records_to_posts_strips_whitespace_only_captions():
    posts = list(
        FacebookVendor._records_to_posts(
            [{"post_id": "x", "url": "u", "text": "   \n  "}], profile_url="P"
        )
    )

    assert posts == []
