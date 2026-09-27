"""P2 — website-agnostic extraction package."""
from __future__ import annotations

from .fetch import SourceFetcher
from .github_traversal import (
    SCAN_DEPTHS,
    collect_repo_code,
    collect_repo_markdown,
    collect_repo_readme,
    gather_repo_sources,
)
from .models import CHARS_PER_TOKEN, DEFAULT_CAP_CHARS, DEFAULT_TOKEN_CAP, CleanedSource, apply_token_cap
from .rules import ExtractionRuleEngine, apply_rules
from .web import extract_website
from .crawler import AgenticCrawler, DEFAULT_OBJECTIVE, PlaywrightPageFetcher, RobotsPolicy
from .crawler_models import (
    CrawlRun,
    ExtractedPage,
    HtmlTagRule,
    LearnedLayout,
    LinkCandidate,
    LinkSelection,
    NodeAction,
)
from .crawler_store import LayoutStore
from .domain_fallbacks import build_default_domain_fallbacks

__all__ = [
    "CleanedSource",
    "CHARS_PER_TOKEN",
    "DEFAULT_TOKEN_CAP",
    "DEFAULT_CAP_CHARS",
    "SourceFetcher",
    "ExtractionRuleEngine",
    "apply_rules",
    "collect_repo_readme",
    "collect_repo_markdown",
    "collect_repo_code",
    "gather_repo_sources",
    "SCAN_DEPTHS",
    "extract_website",
    "apply_token_cap",
    "AgenticCrawler",
    "DEFAULT_OBJECTIVE",
    "PlaywrightPageFetcher",
    "RobotsPolicy",
    "CrawlRun",
    "ExtractedPage",
    "HtmlTagRule",
    "LearnedLayout",
    "LinkCandidate",
    "LinkSelection",
    "NodeAction",
    "LayoutStore",
    "build_default_domain_fallbacks",
]
