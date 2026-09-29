from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass
from typing import Callable, Protocol
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import requests

from ..llm.base import LLMProvider
from .crawler_dom import (
    apply_tag_rules,
    build_dom_inventory,
    fingerprint,
    readability_text,
    safe_same_domain_url,
)
from .crawler_models import (
    CrawlRun,
    ExtractedPage,
    FailedPage,
    HtmlTagRule,
    LearnedLayout,
    LinkCandidate,
    LinkSelection,
)
from .crawler_store import LayoutStore
from .domain_fallbacks import DomainFallback, build_default_domain_fallbacks

log = logging.getLogger(__name__)

DEFAULT_OBJECTIVE = (
    "Collect project descriptions, achievements, technologies, and verifiable evidence useful "
    "for resume generation. Follow only pages that can add evidence for that objective."
)

_RULE_SYSTEM = """You are the structure-learning component of a website-agnostic crawler.
You observe a rendered DOM inventory. Classify HTML selectors only; do not return extracted prose.
Every useful structural region must receive exactly one action:
- ignore: neither extract text nor follow links (site chrome, ads, auth/action controls, noise).
- extract: extract inner text but do not crawl links.
- crawl: do not extract the container text, but allow useful links inside it to be considered.
- extract_and_crawl: extract inner text and consider useful links inside it.

Prefer stable selectors using tag#id, tag.class, tag[role=value], or a plain tag. Do not invent
selectors absent from the inventory. The seed is the site's main page. On that page, identify the
main top navigation and permit links from useful categories so the link-selection agent can sample
one representative page per useful top-bar category. Ignore login/logout, destructive actions,
forms, ads, legal boilerplate, and irrelevant global navigation. Same-domain GET navigation only.
The rules will be executed deterministically, so the action labels must be operationally correct."""

_LINK_SYSTEM = """You select a small, representative crawl sample from links already permitted by
HTML tag rules. The objective is supplied by the caller. Stay on the seed domain. On the main page,
sample one representative useful page for each useful main top-navigation category. On deeper
pages, select only links likely to add distinct evidence or expose a distinct layout. Adapt the
sample size to the number and quality of links; do not crawl everything. Never select login,
logout, account, delete, checkout, form-action, pagination traps, calendars, or duplicate URLs."""


class PageFetcher(Protocol):
    def __call__(self, url: str) -> str: ...


class PlaywrightPageFetcher:
    """Fetch the actual rendered DOM. Playwright is imported lazily."""

    def __init__(self, *, headless: bool = True, timeout_ms: int = 30_000) -> None:
        self.headless = headless
        self.timeout_ms = timeout_ms

    def __call__(self, url: str) -> str:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise RuntimeError(
                "Playwright is required for the rendered-DOM crawler; install playwright and Chromium."
            ) from exc
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=self.headless)
            try:
                page = browser.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)
                try:
                    page.wait_for_load_state("networkidle", timeout=min(self.timeout_ms, 8_000))
                except Exception:
                    pass
                return page.content() or ""
            finally:
                browser.close()


class RobotsPolicy:
    """Per-origin robots.txt policy with an injectable loader for deterministic tests."""

    def __init__(self, loader: Callable[[str], str] | None = None, user_agent: str = "pytorch-ph-crawler"):
        self.loader = loader or self._load
        self.user_agent = user_agent
        self._cache: dict[str, RobotFileParser] = {}

    @staticmethod
    def _load(url: str) -> str:
        response = requests.get(url, timeout=10, headers={"User-Agent": "pytorch-ph-crawler"})
        return response.text if response.ok else ""

    def allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        parser = self._cache.get(origin)
        if parser is None:
            parser = RobotFileParser()
            parser.set_url(f"{origin}/robots.txt")
            try:
                text = self.loader(parser.url)
                parser.parse(text.splitlines())
            except Exception as exc:
                log.warning("robots.txt check failed for %s: %s", origin, exc)
                parser.parse([])
            self._cache[origin] = parser
        return parser.can_fetch(self.user_agent, url)


@dataclass
class _QueueItem:
    url: str
    depth: int


class AgenticCrawler:
    """Observe -> infer -> test -> revise -> crawl loop driven by learned HTML-tag actions."""

    def __init__(
        self,
        llm: LLMProvider,
        fetch_page: PageFetcher | None = None,
        store: LayoutStore | None = None,
        robots: RobotsPolicy | None = None,
        domain_fallbacks: dict[str, DomainFallback] | None = None,
        *,
        max_depth: int = 3,
        max_pages: int = 25,
        min_content_chars: int = 80,
    ) -> None:
        self.llm = llm
        self.fetch_page = fetch_page or PlaywrightPageFetcher()
        self.store = store or LayoutStore()
        self.robots = robots or RobotsPolicy()
        fallbacks = build_default_domain_fallbacks() if domain_fallbacks is None else domain_fallbacks
        self.domain_fallbacks = {k.lower(): v for k, v in fallbacks.items()}
        self.max_depth = max_depth
        self.max_pages = max_pages
        self.min_content_chars = min_content_chars

    def crawl(self, seed_url: str, objective: str = DEFAULT_OBJECTIVE) -> CrawlRun:
        seed = safe_same_domain_url(seed_url, seed_url)
        if seed is None:
            raise ValueError("seed_url must be an absolute HTTP(S) URL")
        run = CrawlRun(seed_url=seed, objective=objective)
        queue = deque([_QueueItem(seed, 0)])
        queued = {seed}
        visited: set[str] = set()

        while queue and len(visited) < self.max_pages:
            item = queue.popleft()
            if item.url in visited:
                continue
            if item.depth > self.max_depth:
                run.skipped_urls.append(item.url)
                continue
            if not self.robots.allowed(item.url):
                run.skipped_urls.append(item.url)
                continue
            visited.add(item.url)
            run.visited_urls.append(item.url)
            try:
                html = self.fetch_page(item.url)
            except Exception as exc:
                run.failed_urls.append(FailedPage(url=item.url, error=f"fetch failed: {exc}"))
                continue
            if not html.strip():
                run.failed_urls.append(FailedPage(url=item.url, error="fetch returned empty HTML"))
                continue

            page, candidates, learned = self._extract_page(item.url, seed, html, objective)
            if learned is not None:
                self.store.put(learned)
            if page is None:
                run.failed_urls.append(
                    FailedPage(url=item.url, error="AI rules, readability, and domain fallback failed")
                )
                continue
            run.extracted_pages.append(page)

            if item.depth >= self.max_depth or not candidates:
                continue
            selected = self._select_links(
                seed_url=seed,
                page_url=item.url,
                candidates=candidates,
                objective=objective,
                is_seed=item.depth == 0,
                remaining=max(0, self.max_pages - len(visited) - len(queue)),
            )
            page.discovered_links = [choice.url for choice in selected.links]
            for choice in selected.links:
                url = safe_same_domain_url(seed, choice.url)
                if not url or url in queued or url in visited:
                    if choice.url not in run.skipped_urls:
                        run.skipped_urls.append(choice.url)
                    continue
                if len(queued) >= self.max_pages * 4:
                    run.skipped_urls.append(url)
                    continue
                queued.add(url)
                queue.append(_QueueItem(url, item.depth + 1))

        run.learned_layouts = self.store.all()
        self.store.write_run(run)
        return run

    def _extract_page(
        self,
        url: str,
        seed_url: str,
        html: str,
        objective: str,
    ) -> tuple[ExtractedPage | None, list[LinkCandidate], LearnedLayout | None]:
        fp = fingerprint(html)
        cached = self.store.get(fp)
        if cached is not None:
            content, links = apply_tag_rules(html, url, seed_url, cached.rules)
            errors = self._validate(content, links, cached.rules, require_crawl=url == seed_url)
            if not errors:
                return self._page(url, fp, content, cached, "ai_rules_cache"), links, None

        inventory = build_dom_inventory(html, url)
        previous: LearnedLayout | None = cached
        errors: list[str] = []
        for attempt in range(2):
            try:
                layout = self._infer_layout(
                    url=url,
                    fp=fp,
                    inventory=inventory,
                    objective=objective,
                    attempt=attempt,
                    previous=previous,
                    errors=errors,
                )
            except Exception as exc:
                errors = [f"AI rule inference failed: {exc}"]
                continue
            content, links = apply_tag_rules(html, url, seed_url, layout.rules)
            errors = self._validate(content, links, layout.rules, require_crawl=url == seed_url)
            if not errors:
                return self._page(url, fp, content, layout, "ai_rules"), links, layout
            previous = layout

        content = readability_text(html)
        if content.strip():
            page = ExtractedPage(
                url=url,
                layout_fingerprint=fp,
                content=content,
                extraction_method="readability",
                revision=1,
            )
            return page, [], None

        domain = urlsplit(seed_url).netloc.lower()
        fallback = self.domain_fallbacks.get(domain)
        if fallback is not None:
            try:
                content = fallback(url, html).strip()
            except Exception as exc:
                log.warning("domain fallback failed for %s: %s", url, exc)
                content = ""
            if content:
                page = ExtractedPage(
                    url=url,
                    layout_fingerprint=fp,
                    content=content,
                    extraction_method="domain_fallback",
                    revision=1,
                )
                return page, [], None
        return None, [], None

    def _infer_layout(
        self,
        *,
        url: str,
        fp: str,
        inventory: str,
        objective: str,
        attempt: int,
        previous: LearnedLayout | None,
        errors: list[str],
    ) -> LearnedLayout:
        revision = ""
        if previous is not None or errors:
            previous_json = previous.model_dump_json(indent=2) if previous is not None else "none"
            revision = (
                "\n\nPREVIOUS RULES:\n"
                f"{previous_json}\n"
                f"VALIDATION ERRORS:\n- " + "\n- ".join(errors)
                + "\nRevise the selector actions to fix these errors."
            )
        prompt = (
            f"OBJECTIVE:\n{objective}\n\nURL: {url}\n"
            f"LAYOUT FINGERPRINT: {fp}\n\nRENDERED DOM INVENTORY:\n{inventory}"
            f"{revision}"
        )
        layout = self.llm.structured(
            prompt, schema=LearnedLayout, system=_RULE_SYSTEM, max_tokens=4096
        )
        layout.domain = urlsplit(url).netloc.lower()
        layout.sample_url = url
        layout.layout_fingerprint = fp
        layout.revision = attempt
        return layout

    def _select_links(
        self,
        *,
        seed_url: str,
        page_url: str,
        candidates: list[LinkCandidate],
        objective: str,
        is_seed: bool,
        remaining: int,
    ) -> LinkSelection:
        if remaining <= 0:
            return LinkSelection()
        prompt = (
            f"OBJECTIVE:\n{objective}\n\nSEED URL: {seed_url}\nCURRENT URL: {page_url}\n"
            f"IS MAIN SEED PAGE: {is_seed}\nMAXIMUM LINKS YOU MAY SELECT: {remaining}\n\n"
            "RULE-PERMITTED LINK CANDIDATES:\n"
            + "\n".join(candidate.model_dump_json() for candidate in candidates)
        )
        try:
            selected = self.llm.structured(
                prompt, schema=LinkSelection, system=_LINK_SYSTEM, max_tokens=2048
            )
        except Exception as exc:
            log.warning("AI link selection failed for %s: %s", page_url, exc)
            return LinkSelection()
        permitted = {candidate.url for candidate in candidates}
        unique = []
        seen = set()
        for choice in selected.links:
            url = safe_same_domain_url(seed_url, choice.url)
            if url and url in permitted and url not in seen:
                seen.add(url)
                choice.url = url
                unique.append(choice)
            if len(unique) >= remaining:
                break
        return LinkSelection(links=unique)

    def _validate(
        self,
        content: str,
        links: list[LinkCandidate],
        rules: list[HtmlTagRule],
        *,
        require_crawl: bool,
    ) -> list[str]:
        errors = []
        if not rules:
            errors.append("No HTML tag rules were returned.")
        if len(content.strip()) < self.min_content_chars:
            errors.append(
                f"Extracted content is too thin ({len(content.strip())} chars; "
                f"minimum {self.min_content_chars})."
            )
        if require_crawl and not any(
            rule.action.value in {"crawl", "extract_and_crawl"} for rule in rules
        ):
            errors.append("No HTML region was marked crawl or extract_and_crawl.")
        elif require_crawl and not links:
            errors.append("Crawl-enabled rules produced no safe same-domain links.")
        return errors

    @staticmethod
    def _page(
        url: str,
        fp: str,
        content: str,
        layout: LearnedLayout,
        method: str,
    ) -> ExtractedPage:
        return ExtractedPage(
            url=url,
            layout_fingerprint=fp,
            content=content,
            extraction_method=method,
            revision=layout.revision,
        )
