"""Aggregator tests: parallel dispatch, dedupe, graceful vendor failure, cache TTL."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from resume_builder.sources.social import (
    ScrapeConfig,
    SocialAggregator,
    SocialMention,
    SocialPost,
)
from resume_builder.sources.social.base import SocialVendor


class _FakeVendor(SocialVendor):
    def __init__(self, name: str, posts: list[SocialPost], mentions: list[SocialMention]):
        self.name = name
        self._posts = posts
        self._mentions = mentions

    def fetch_own_posts(self, handle: str, limit: int = 50) -> list[SocialPost]:
        return self._posts

    def search_mentions(self, full_name: str, limit: int = 50) -> list[SocialMention]:
        return self._mentions


class _ExplodingVendor(SocialVendor):
    name = "boom"

    def fetch_own_posts(self, handle, limit=50):
        raise RuntimeError("nope")

    def search_mentions(self, full_name, limit=50):
        raise RuntimeError("nope")


@pytest.fixture()
def cache_dir(tmp_path: Path) -> Path:
    return tmp_path / "cache"


def _post(vendor: str, post_id: str, text: str = "hello world") -> SocialPost:
    return SocialPost(vendor=vendor, post_id=post_id, url=f"https://x/{post_id}", text=text)


def _mention(vendor: str, mention_id: str) -> SocialMention:
    return SocialMention(vendor=vendor, mention_id=mention_id, url=f"https://x/{mention_id}", text="t", author_name="A")


def test_collect_runs_only_enabled_vendors(cache_dir: Path):
    agg = SocialAggregator(cache_dir=cache_dir)
    agg.register("a", lambda: _FakeVendor("a", [_post("a", "1")], [_mention("a", "m1")]))
    agg.register("b", lambda: _FakeVendor("b", [_post("b", "2")], []))

    # include_mentions=True to exercise both own-posts and the opt-in search-bar path.
    cfg = ScrapeConfig(
        full_name="X", enabled_vendors=("a",), handles={"a": "h"}, include_mentions=True
    )
    result = agg.collect(cfg)

    assert {p.post_id for p in result.posts} == {"1"}
    assert {m.mention_id for m in result.mentions} == {"m1"}
    assert result.failures == {}


def test_mentions_off_by_default_owns_posts_only(cache_dir: Path):
    agg = SocialAggregator(cache_dir=cache_dir)
    agg.register("a", lambda: _FakeVendor("a", [_post("a", "1")], [_mention("a", "m1")]))

    cfg = ScrapeConfig(full_name="X", enabled_vendors=("a",), handles={"a": "h"})
    result = agg.collect(cfg)

    # Default = own posts only; search-bar mentions are NOT collected.
    assert {p.post_id for p in result.posts} == {"1"}
    assert result.mentions == []


def test_unknown_vendor_records_failure_without_crashing(cache_dir: Path):
    agg = SocialAggregator(cache_dir=cache_dir)
    cfg = ScrapeConfig(full_name="X", enabled_vendors=("ghost",))
    result = agg.collect(cfg)
    assert "ghost" in result.failures


def test_exploding_vendor_is_isolated(cache_dir: Path):
    agg = SocialAggregator(cache_dir=cache_dir)
    agg.register("boom", lambda: _ExplodingVendor())
    agg.register("ok", lambda: _FakeVendor("ok", [_post("ok", "1")], []))

    cfg = ScrapeConfig(full_name="X", enabled_vendors=("boom", "ok"), handles={"boom": "h", "ok": "h"})
    result = agg.collect(cfg)

    assert any(p.vendor == "ok" for p in result.posts)


def test_dedupe_collapses_identical_text_across_vendors(cache_dir: Path):
    agg = SocialAggregator(cache_dir=cache_dir)
    agg.register("a", lambda: _FakeVendor("a", [_post("a", "1", "Same announcement")], []))
    agg.register("b", lambda: _FakeVendor("b", [_post("b", "2", "Same announcement")], []))

    cfg = ScrapeConfig(full_name="X", enabled_vendors=("a", "b"), handles={"a": "h", "b": "h"})
    result = agg.collect(cfg)
    assert len(result.posts) == 1


def test_cache_round_trips(cache_dir: Path):
    agg = SocialAggregator(cache_dir=cache_dir)
    call_count = {"n": 0}

    def factory():
        call_count["n"] += 1
        return _FakeVendor("a", [_post("a", "1")], [])

    agg.register("a", factory)
    cfg = ScrapeConfig(full_name="X", enabled_vendors=("a",), handles={"a": "h"}, cache_ttl_seconds=3600)
    agg.collect(cfg)
    agg.collect(cfg)
    assert call_count["n"] == 1, "second collect should hit cache"

    cached = json.loads((cache_dir / "a.json").read_text())
    assert cached["posts"][0]["post_id"] == "1"


def test_available_vendors_sorted(cache_dir: Path):
    agg = SocialAggregator(cache_dir=cache_dir)
    agg.register("zebra", lambda: _FakeVendor("zebra", [], []))
    agg.register("alpha", lambda: _FakeVendor("alpha", [], []))
    assert agg.available_vendors() == ["alpha", "zebra"]
