"""Social-media middleman package.

Public surface is intentionally narrow: the aggregator and its data models.
Vendor implementations stay private to discourage callers from coupling to a
specific platform's API shape.
"""

from .aggregator import CollectResult, SocialAggregator, build_default_aggregator
from .base import SocialVendor, VendorUnavailableError
from .models import ScrapeConfig, SocialMention, SocialPost

__all__ = [
    "CollectResult",
    "ScrapeConfig",
    "SocialAggregator",
    "SocialMention",
    "SocialPost",
    "SocialVendor",
    "VendorUnavailableError",
    "build_default_aggregator",
    "load_scrape_config",
]


def load_scrape_config(path: str) -> ScrapeConfig:
    """Load a `ScrapeConfig` from a YAML file path."""
    import yaml  # local import keeps PyYAML optional at import time

    with open(path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    raw["enabled_vendors"] = tuple(raw.get("enabled_vendors") or ())
    return ScrapeConfig.model_validate(raw)
