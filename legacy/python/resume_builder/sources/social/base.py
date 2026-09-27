"""Abstract `SocialVendor` interface.

Concrete handlers (facebook, linkedin, twitter, instagram) subclass this. The
aggregator never imports concrete vendors directly — only this interface.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from .models import SocialMention, SocialPost


class VendorUnavailableError(RuntimeError):
    """Raised by a vendor when its endpoint is blocked, auth-failed, or unreachable.

    The aggregator catches this and degrades to an empty result for that vendor.
    """


class SocialVendor(ABC):
    name: str = "abstract"

    @abstractmethod
    def fetch_own_posts(self, handle: str, limit: int = 50) -> list[SocialPost]:
        """Return the user's own posts. Empty list on failure (do not raise)."""

    @abstractmethod
    def search_mentions(self, full_name: str, limit: int = 50) -> list[SocialMention]:
        """Return posts authored by others that mention the user's name."""
