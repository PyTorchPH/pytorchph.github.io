"""SocialAggregator — the middleman.

Holds a registry of vendor handlers keyed by name and dispatches collection in parallel.
Cross-vendor dedupe is by `(vendor, id)` then by content hash so a Facebook + LinkedIn
crosspost of the same announcement collapses to one record.

The aggregator never re-raises a vendor failure. Each vendor is wrapped in a try/except
boundary so one broken handler cannot fail the whole build.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .base import SocialVendor
from .models import ScrapeConfig, SocialMention, SocialPost

log = logging.getLogger(__name__)

VendorFactory = Callable[[], SocialVendor]


@dataclass
class CollectResult:
    posts: list[SocialPost] = field(default_factory=list)
    mentions: list[SocialMention] = field(default_factory=list)
    failures: dict[str, str] = field(default_factory=dict)


def _default_cache_dir() -> Path:
    home = Path(os.environ.get("RESUME_BUILDER_CACHE") or (Path.home() / ".cache" / "resume-builder" / "social"))
    home.mkdir(parents=True, exist_ok=True)
    return home


class SocialAggregator:
    """Dispatch + dedupe + cache."""

    def __init__(
        self,
        registry: dict[str, VendorFactory] | None = None,
        cache_dir: Path | None = None,
        max_workers: int = 4,
        use_cache: bool = True,
    ) -> None:
        self._registry = dict(registry or {})
        self._cache_dir = cache_dir or _default_cache_dir()
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._max_workers = max_workers
        self.use_cache = use_cache

    # ---- public ----

    def register(self, name: str, factory: VendorFactory) -> None:
        self._registry[name] = factory

    def available_vendors(self) -> list[str]:
        return sorted(self._registry)

    def collect(self, config: ScrapeConfig) -> CollectResult:
        result = CollectResult()
        targets = [v for v in config.enabled_vendors if v in self._registry]
        unknown = [v for v in config.enabled_vendors if v not in self._registry]
        for v in unknown:
            result.failures[v] = "not registered"

        with ThreadPoolExecutor(max_workers=self._max_workers) as ex:
            futures = {
                ex.submit(self._collect_one, name, config): name for name in targets
            }
            for fut in as_completed(futures):
                name = futures[fut]
                try:
                    posts, mentions = fut.result()
                    result.posts.extend(posts)
                    result.mentions.extend(mentions)
                except Exception as exc:  # noqa: BLE001 - aggregator boundary
                    log.warning("vendor %s failed: %s", name, exc)
                    result.failures[name] = str(exc)

        result.posts = self._dedupe_posts(result.posts)
        result.mentions = self._dedupe_mentions(result.mentions)
        return result

    # ---- internals ----

    def _collect_one(
        self, name: str, config: ScrapeConfig
    ) -> tuple[list[SocialPost], list[SocialMention]]:
        if self.use_cache:
            cached = self._read_cache(name, config.cache_ttl_seconds)
            if cached is not None:
                return cached

        vendor = self._registry[name]()
        handle = config.handles.get(name, "")
        posts: list[SocialPost] = []
        mentions: list[SocialMention] = []
        if handle:
            try:
                posts = vendor.fetch_own_posts(handle, limit=config.per_vendor_limit) or []
            except Exception as exc:  # noqa: BLE001
                log.warning("%s.fetch_own_posts failed: %s", name, exc)
        # Search-bar mentions are opt-in: they return posts the user did NOT author
        # (e.g. anyone mentioning the name), which do not belong on the user's own resume.
        if config.include_mentions:
            try:
                mentions = vendor.search_mentions(config.full_name, limit=config.per_vendor_limit) or []
            except Exception as exc:  # noqa: BLE001
                log.warning("%s.search_mentions failed: %s", name, exc)

        if self.use_cache:
            self._write_cache(name, posts, mentions)
        return posts, mentions

    @staticmethod
    def _dedupe_posts(posts: list[SocialPost]) -> list[SocialPost]:
        seen_ids: set[tuple[str, str]] = set()
        seen_hashes: set[str] = set()
        out: list[SocialPost] = []
        for p in posts:
            key = (p.vendor, p.post_id)
            if key in seen_ids:
                continue
            h = hashlib.sha1(p.text.strip().lower().encode("utf-8", errors="ignore")).hexdigest()
            if p.text and h in seen_hashes:
                continue
            seen_ids.add(key)
            if p.text:
                seen_hashes.add(h)
            out.append(p)
        return out

    @staticmethod
    def _dedupe_mentions(mentions: list[SocialMention]) -> list[SocialMention]:
        seen: set[tuple[str, str]] = set()
        out: list[SocialMention] = []
        for m in mentions:
            key = (m.vendor, m.mention_id)
            if key in seen:
                continue
            seen.add(key)
            out.append(m)
        return out

    # ---- cache ----

    def _cache_path(self, name: str) -> Path:
        return self._cache_dir / f"{name}.json"

    def _read_cache(
        self, name: str, ttl: int
    ) -> tuple[list[SocialPost], list[SocialMention]] | None:
        path = self._cache_path(name)
        if not path.exists():
            return None
        if time.time() - path.stat().st_mtime > ttl:
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            posts = [SocialPost.model_validate(p) for p in data.get("posts", [])]
            mentions = [SocialMention.model_validate(m) for m in data.get("mentions", [])]
            return posts, mentions
        except Exception as exc:  # noqa: BLE001
            log.debug("cache miss for %s: %s", name, exc)
            return None

    def _write_cache(
        self, name: str, posts: list[SocialPost], mentions: list[SocialMention]
    ) -> None:
        path = self._cache_path(name)
        try:
            payload = {
                "posts": [p.model_dump(mode="json") for p in posts],
                "mentions": [m.model_dump(mode="json") for m in mentions],
            }
            path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
        except Exception as exc:  # noqa: BLE001
            log.debug("cache write failed for %s: %s", name, exc)


def build_default_aggregator() -> SocialAggregator:
    """Registry factory wired with the bundled vendors. Lazy imports so missing
    optional deps never break unrelated code paths."""

    agg = SocialAggregator()

    def _fb() -> SocialVendor:
        from .vendors.facebook import FacebookVendor
        return FacebookVendor()

    def _li() -> SocialVendor:
        from .vendors.linkedin import LinkedInVendor
        return LinkedInVendor()

    def _tw() -> SocialVendor:
        from .vendors.twitter import TwitterVendor
        return TwitterVendor()

    def _ig() -> SocialVendor:
        from .vendors.instagram import InstagramVendor
        return InstagramVendor()

    agg.register("facebook", _fb)
    agg.register("linkedin", _li)
    agg.register("twitter", _tw)
    agg.register("instagram", _ig)
    return agg
