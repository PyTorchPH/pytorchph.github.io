from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class NodeAction(str, Enum):
    IGNORE = "ignore"
    EXTRACT = "extract"
    CRAWL = "crawl"
    EXTRACT_AND_CRAWL = "extract_and_crawl"


class HtmlTagRule(BaseModel):
    """AI classification attached to an HTML selector, not to extracted prose."""

    selector: str
    action: NodeAction
    reason: str = ""


class LearnedLayout(BaseModel):
    domain: str
    sample_url: str
    layout_fingerprint: str
    rules: list[HtmlTagRule] = Field(default_factory=list)
    revision: int = 0


class LinkCandidate(BaseModel):
    url: str
    text: str = ""
    source_selector: str = ""


class LinkChoice(BaseModel):
    url: str
    reason: str = ""
    category: str = ""


class LinkSelection(BaseModel):
    """Dynamic, bounded sample selected from links permitted by learned tag rules."""

    links: list[LinkChoice] = Field(default_factory=list)


class ExtractedPage(BaseModel):
    url: str
    layout_fingerprint: str
    content: str = ""
    discovered_links: list[str] = Field(default_factory=list)
    extraction_method: str = "ai_rules"
    revision: int = 0


class FailedPage(BaseModel):
    url: str
    error: str


class CrawlRun(BaseModel):
    seed_url: str
    objective: str
    visited_urls: list[str] = Field(default_factory=list)
    skipped_urls: list[str] = Field(default_factory=list)
    failed_urls: list[FailedPage] = Field(default_factory=list)
    extracted_pages: list[ExtractedPage] = Field(default_factory=list)
    learned_layouts: list[LearnedLayout] = Field(default_factory=list)

