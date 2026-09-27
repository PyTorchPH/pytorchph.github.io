from __future__ import annotations

import json

from resume_builder.extraction.crawler import AgenticCrawler, RobotsPolicy
from resume_builder.extraction.crawler_dom import apply_tag_rules, build_dom_inventory, fingerprint
from resume_builder.extraction.crawler_models import (
    HtmlTagRule,
    LearnedLayout,
    LinkChoice,
    LinkSelection,
    NodeAction,
)
from resume_builder.extraction.crawler_store import LayoutStore

_HOME = """
<html><body>
  <header class="topbar"><a href="/projects">Projects</a><a href="/about">About</a>
    <a href="https://external.example/jobs">External</a><a href="/logout">Logout</a></header>
  <main class="content"><h1>Engineering portfolio</h1><p>This portfolio documents substantial
  project achievements, technologies, architecture decisions, and measurable engineering results.</p></main>
  <footer>Copyright and legal boilerplate</footer>
</body></html>
"""

_PROJECTS = """
<html><body><nav>Menu</nav><article class="project"><h1>Compiler Project</h1>
<p>Designed and implemented a compiler pipeline with lexical analysis, parsing, optimization,
and generated code. The project includes documented tests and measurable build improvements.</p>
</article><footer>Copyright</footer></body></html>
"""


class _RobotsAllow:
    def allowed(self, url: str) -> bool:
        return True


class _CrawlerLLM:
    def __init__(self) -> None:
        self.layout_calls = 0
        self.prompts: list[str] = []

    def structured(self, prompt, schema, system=None, max_tokens=2048):
        self.prompts.append(prompt)
        if schema is LinkSelection:
            return LinkSelection(
                links=[LinkChoice(url="https://example.com/projects", category="Projects")]
            )
        self.layout_calls += 1
        if "CURRENT URL" in prompt:
            raise AssertionError("link selection used the wrong schema")
        if "URL: https://example.com/projects" in prompt:
            return LearnedLayout(
                domain="wrong",
                sample_url="wrong",
                layout_fingerprint="wrong",
                rules=[
                    HtmlTagRule(selector="nav", action=NodeAction.IGNORE),
                    HtmlTagRule(selector="article.project", action=NodeAction.EXTRACT),
                    HtmlTagRule(selector="footer", action=NodeAction.IGNORE),
                ],
            )
        return LearnedLayout(
            domain="wrong",
            sample_url="wrong",
            layout_fingerprint="wrong",
            rules=[
                HtmlTagRule(selector="header.topbar", action=NodeAction.CRAWL),
                HtmlTagRule(selector="main.content", action=NodeAction.EXTRACT),
                HtmlTagRule(selector="footer", action=NodeAction.IGNORE),
            ],
        )


class _ReviseLLM(_CrawlerLLM):
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        if schema is LinkSelection:
            return LinkSelection()
        self.prompts.append(prompt)
        self.layout_calls += 1
        if self.layout_calls == 1:
            return LearnedLayout(
                domain="x", sample_url="x", layout_fingerprint="x", rules=[]
            )
        return LearnedLayout(
            domain="x",
            sample_url="x",
            layout_fingerprint="x",
            rules=[
                HtmlTagRule(selector="header.topbar", action=NodeAction.CRAWL),
                HtmlTagRule(selector="main.content", action=NodeAction.EXTRACT),
            ],
        )


def test_dom_inventory_exposes_tags_selectors_and_link_samples():
    inventory = build_dom_inventory(_HOME, "https://example.com/")
    assert "selector='header.topbar'" in inventory
    assert "descendant_links=4" in inventory
    assert "https://example.com/projects" in inventory


def test_dom_inventory_carries_link_names_for_relevance_judgement():
    # The AI must be able to judge a link by its NAME, not just its URL.
    inventory = build_dom_inventory(_HOME, "https://example.com/")
    assert "'Projects'->https://example.com/projects" in inventory
    assert "'About'->https://example.com/about" in inventory


def test_fingerprint_is_strict_about_class_vocabulary():
    base = "<html><body><main class='content'><p>{}</p></main></body></html>"
    same_vocab_a = base.format("alpha alpha alpha alpha alpha")
    same_vocab_b = base.format("totally different content here entirely")
    different_vocab = "<html><body><section class='panel'><p>x</p></section></body></html>"
    # identical stable vocabulary, different text => same cache key
    assert fingerprint(same_vocab_a) == fingerprint(same_vocab_b)
    # any vocabulary difference => assumed a different layout (cache miss)
    assert fingerprint(same_vocab_a) != fingerprint(different_vocab)


def test_repeated_layout_is_served_from_cache_without_new_llm_calls():
    home = (
        "<html><body><header class='topbar'>"
        "<a href='/a'>Alpha</a><a href='/b'>Beta</a></header>"
        "<main class='content'><h1>Home</h1><p>"
        + "Home page evidence describing measurable engineering work. " * 4
        + "</p></main></body></html>"
    )
    page_a = (
        "<html><body><header class='topbar'>"
        "<a href='/a'>Alpha</a><a href='/b'>Beta</a></header>"
        "<main class='content'><h1>Alpha</h1><p>"
        + "Alpha page evidence describing a different shipped project entirely. " * 4
        + "</p></main></body></html>"
    )
    pages = {"https://example.com/": home, "https://example.com/a": page_a}

    class _CountingLLM:
        def __init__(self) -> None:
            self.rule_calls = 0
            self.link_calls = 0

        def structured(self, prompt, schema, system=None, max_tokens=2048):
            if schema is LinkSelection:
                self.link_calls += 1
                return LinkSelection(
                    links=[LinkChoice(url="https://example.com/a", category="Alpha")]
                )
            self.rule_calls += 1
            return LearnedLayout(
                domain="x",
                sample_url="x",
                layout_fingerprint="x",
                rules=[
                    HtmlTagRule(selector="header.topbar", action=NodeAction.CRAWL),
                    HtmlTagRule(selector="main.content", action=NodeAction.EXTRACT),
                ],
            )

    llm = _CountingLLM()
    crawler = AgenticCrawler(
        llm,
        fetch_page=pages.__getitem__,
        store=LayoutStore(output_dir=None),
        robots=_RobotsAllow(),
        max_depth=1,
        max_pages=5,
    )
    run = crawler.crawl("https://example.com/")

    assert [p.url for p in run.extracted_pages] == [
        "https://example.com/",
        "https://example.com/a",
    ]
    # /a shares the seed's exact class vocabulary => one fingerprint => the AI
    # learns the layout ONCE; the second page is replayed in pure Python.
    assert llm.rule_calls == 1
    assert run.extracted_pages[1].extraction_method == "ai_rules_cache"
    assert len(run.learned_layouts) == 1


def test_tag_actions_control_content_and_crawl_links():
    content, links = apply_tag_rules(
        _HOME,
        "https://example.com/",
        "https://example.com/",
        [
            HtmlTagRule(selector="header.topbar", action=NodeAction.CRAWL),
            HtmlTagRule(selector="main.content", action=NodeAction.EXTRACT),
            HtmlTagRule(selector="footer", action=NodeAction.IGNORE),
        ],
    )
    assert "Engineering portfolio" in content
    assert "Projects" not in content
    assert "Copyright" not in content
    assert [link.url for link in links] == [
        "https://example.com/projects",
        "https://example.com/about",
    ]


def test_agent_observes_learns_selects_and_crawls_same_domain():
    pages = {
        "https://example.com/": _HOME,
        "https://example.com/projects": _PROJECTS,
    }
    llm = _CrawlerLLM()
    crawler = AgenticCrawler(
        llm,
        fetch_page=pages.__getitem__,
        store=LayoutStore(output_dir=None),
        robots=_RobotsAllow(),
        max_depth=2,
        max_pages=5,
    )
    run = crawler.crawl("https://example.com/")
    assert run.visited_urls == ["https://example.com/", "https://example.com/projects"]
    assert len(run.extracted_pages) == 2
    assert "Compiler Project" in run.extracted_pages[1].content
    assert len(run.learned_layouts) == 2
    assert all(layout.domain == "example.com" for layout in run.learned_layouts)


def test_invalid_first_rules_are_revised_once_with_validation_errors():
    llm = _ReviseLLM()
    crawler = AgenticCrawler(
        llm,
        fetch_page=lambda _: _HOME,
        store=LayoutStore(output_dir=None),
        robots=_RobotsAllow(),
        max_depth=0,
        max_pages=1,
    )
    run = crawler.crawl("https://example.com/")
    assert llm.layout_calls == 2
    assert run.extracted_pages[0].revision == 1
    assert "VALIDATION ERRORS" in llm.prompts[1]
    assert "PREVIOUS RULES" in llm.prompts[1]


def test_store_writes_layout_and_dynamic_run_json(tmp_path):
    llm = _CrawlerLLM()
    store = LayoutStore(output_dir=tmp_path)
    crawler = AgenticCrawler(
        llm,
        fetch_page=lambda _: _HOME,
        store=store,
        robots=_RobotsAllow(),
        max_depth=0,
        max_pages=1,
    )
    run = crawler.crawl("https://example.com/")
    payload = json.loads((tmp_path / "latest-run.json").read_text(encoding="utf-8"))
    assert payload["visited_urls"] == run.visited_urls
    assert payload["learned_layouts"][0]["rules"][0]["action"] == "crawl"
    assert list(tmp_path.glob("example.com-*.json"))
    assert len(LayoutStore(output_dir=tmp_path).all()) == 1


def test_ai_inference_error_gets_one_retry_then_readability():
    class _BrokenLLM:
        def __init__(self):
            self.calls = 0
            self.prompts = []

        def structured(self, prompt, schema, system=None, max_tokens=2048):
            self.calls += 1
            self.prompts.append(prompt)
            raise RuntimeError("invalid structured output")

    llm = _BrokenLLM()
    crawler = AgenticCrawler(
        llm,
        fetch_page=lambda _: _HOME,
        store=LayoutStore(output_dir=None),
        robots=_RobotsAllow(),
        max_pages=1,
    )
    run = crawler.crawl("https://example.com/")
    assert llm.calls == 2
    assert "AI rule inference failed" in llm.prompts[1]
    assert run.extracted_pages[0].extraction_method == "readability"


def test_robots_policy_blocks_disallowed_path():
    policy = RobotsPolicy(loader=lambda _: "User-agent: *\nDisallow: /private\n")
    assert policy.allowed("https://example.com/public")
    assert not policy.allowed("https://example.com/private/report")
