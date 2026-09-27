"""Pydantic models for the social-media middleman.

Models are frozen / extra="forbid" so vendor handlers cannot smuggle extra fields past
the aggregator boundary. Cross-vendor normalization happens here, not in renderers.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SocialPost(BaseModel):
    """Own-posted content from a single vendor."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    vendor: str
    post_id: str
    url: str
    posted_at: datetime | None = None
    text: str = ""
    media_urls: tuple[str, ...] = ()
    engagement: dict[str, int] = Field(default_factory=dict)


class SocialMention(BaseModel):
    """Self-mention or tag authored by someone else."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    vendor: str
    mention_id: str
    url: str
    posted_at: datetime | None = None
    text: str = ""
    author_name: str = ""


class ScrapeConfig(BaseModel):
    """Declarative config loaded from social.yaml."""

    model_config = ConfigDict(extra="forbid")

    full_name: str
    enabled_vendors: tuple[str, ...]
    handles: dict[str, str] = Field(default_factory=dict)
    cache_ttl_seconds: int = 21600
    per_vendor_limit: int = 50
    # Own profile posts only by default. Search-bar "mentions" (e.g. FB /search/posts)
    # pull content the user did NOT author, so they are opt-in, not the default.
    include_mentions: bool = False
