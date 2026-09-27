"""FacebookVendor Playwright scrape: dispatches when storage_state present,
parses scroll-collected article snapshots into posts and mentions correctly.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from resume_builder.sources.social.auth import SessionStore
from resume_builder.sources.social.vendors.facebook import FacebookVendor


_PROFILE_ARTICLES = [
    {
        "post_id": "12345",
        "url": "https://www.facebook.com/jane.doe/posts/12345",
        "author": "Jane Doe",
        "text": "NASA Space Apps 2024 Top 8 — People's Choice Award.",
    },
    {
        "post_id": "67890",
        "url": "https://www.facebook.com/jane.doe/posts/67890",
        "author": "Jane Doe",
        "text": "Built an XSS sanitization layer for our project.",
    },
    # Duplicate id — proves dedupe.
    {
        "post_id": "12345",
        "url": "https://www.facebook.com/jane.doe/posts/12345",
        "author": "Jane Doe",
        "text": "NASA Space Apps 2024 Top 8 — People's Choice Award.",
    },
    # Empty text — must be filtered out.
    {"post_id": "blank", "url": "", "author": "", "text": ""},
]

_SEARCH_ARTICLES = [
    {
        "post_id": "55555",
        "url": "https://www.facebook.com/permalink/55555",
        "author": "Justine Jude Pura",
        "text": "Congrats Jane Doe for the win!",
    },
    # Mention noise — does not contain the searched name -> filtered out.
    {
        "post_id": "66666",
        "url": "https://www.facebook.com/permalink/66666",
        "author": "Someone Else",
        "text": "Random unrelated post about something else.",
    },
]


@pytest.fixture()
def fb_vendor_with_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))
    store = SessionStore(base_dir=tmp_path)
    store.save_storage_state(
        "facebook", {"cookies": [{"name": "c_user", "value": "100"}], "origins": []}
    )
    return FacebookVendor(cookies={"c_user": "100"}, session_store=store)


def test_fetch_own_posts_uses_playwright_scrape_when_state_present(fb_vendor_with_state):
    with patch.object(
        fb_vendor_with_state, "_scrape_own_post_records", return_value=_PROFILE_ARTICLES
    ) as scrape:
        posts = fb_vendor_with_state.fetch_own_posts("jane.doe")
    scrape.assert_called_once()
    call_url = scrape.call_args.args[0]
    assert call_url == "https://www.facebook.com/jane.doe"
    # 2 unique posts (duplicate + empty filtered out)
    assert len(posts) == 2
    assert {p.post_id for p in posts} == {"12345", "67890"}
    assert any("NASA" in p.text for p in posts)


def test_search_mentions_filters_to_name_matches(fb_vendor_with_state):
    with patch.object(
        fb_vendor_with_state, "_scrape_articles", return_value=_SEARCH_ARTICLES
    ) as scrape:
        mentions = fb_vendor_with_state.search_mentions("Jane Doe")
    scrape.assert_called_once()
    assert "search/posts" in scrape.call_args.args[0]
    # Only one entry actually mentions the name.
    assert len(mentions) == 1
    assert mentions[0].author_name == "Justine Jude Pura"
    assert "Congrats" in mentions[0].text


def test_falls_back_to_mbasic_curl_when_no_storage_state(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))
    store = SessionStore(base_dir=tmp_path)  # no storage_state saved
    vendor = FacebookVendor(cookies={"c_user": "100", "xs": "x"}, session_store=store)
    with (
        patch.object(vendor, "_scrape_articles") as scrape,
        patch.object(vendor, "_get", return_value="") as curl,
    ):
        result = vendor.fetch_own_posts("jane.doe")
    scrape.assert_not_called()
    curl.assert_called_once()
    assert result == []


def test_can_opt_out_of_playwright_via_constructor(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("RESUME_BUILDER_CACHE", str(tmp_path))
    store = SessionStore(base_dir=tmp_path)
    store.save_storage_state("facebook", {"cookies": [], "origins": []})
    vendor = FacebookVendor(
        cookies={"c_user": "100"}, prefer_headless=False, session_store=store
    )
    with (
        patch.object(vendor, "_scrape_articles") as scrape,
        patch.object(vendor, "_get", return_value="") as curl,
    ):
        vendor.fetch_own_posts("jane.doe")
    scrape.assert_not_called()
    curl.assert_called_once()


def test_limit_caps_returned_posts(fb_vendor_with_state):
    """Even though the scrape captures everything, the public limit honours the cap."""
    many_articles = [
        {"post_id": str(i), "url": f"/p/{i}", "author": "me", "text": f"post {i}"}
        for i in range(25)
    ]
    with patch.object(
        fb_vendor_with_state, "_scrape_own_post_records", return_value=many_articles
    ):
        posts = fb_vendor_with_state.fetch_own_posts("jane.doe", limit=5)
    assert len(posts) == 5
