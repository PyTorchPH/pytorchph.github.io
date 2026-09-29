from __future__ import annotations

from resume_builder.extraction.fetch import SourceFetcher
from resume_builder.extraction.rules import ExtractionRuleEngine
from resume_builder.extraction.web import extract_website
from resume_builder.classification.industry import ExtractionRule

_PAGE = (
    "<html><body><header class='nav'>Menu Home</header>"
    "<main><article class='post'>Built a PyTorch model and trained it.</article></main>"
    "<footer>copyright</footer></body></html>"
)


class _RuleLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        return schema(source_id="x", keep_selectors=["article.post"])


def _fetcher(html):
    return SourceFetcher(http_get=lambda u: html, headless_fetch=None)


def test_extract_website_returns_clean_content():
    cs = extract_website("http://x", _fetcher(_PAGE), ExtractionRuleEngine(_RuleLLM()))
    assert cs.kind == "website" and cs.source_id == "http://x"
    assert cs.text.strip() == "Built a PyTorch model and trained it."
    assert "Menu" not in cs.text and "copyright" not in cs.text


def test_token_cap_truncates_and_flags():
    big = "<html><body><article class='post'>" + ("word " * 5000) + "</article></body></html>"
    cs = extract_website("http://x", _fetcher(big), ExtractionRuleEngine(_RuleLLM()), cap_chars=100)
    assert cs.truncated is True and len(cs.text) <= 100


def test_empty_extraction_marks_degraded():
    class _Empty:
        def structured(self, *a, **k):
            return ExtractionRule(source_id="x", keep_selectors=["nope.none"])

    cs = extract_website("http://x", _fetcher(_PAGE), ExtractionRuleEngine(_Empty()))
    assert cs.degraded is True
