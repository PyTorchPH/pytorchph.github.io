from __future__ import annotations

from resume_builder.classification.industry import ExtractionRule
from resume_builder.extraction.rules import ExtractionRuleEngine, apply_rules

_HTML = """
<html><body>
  <header class="nav">Home About Contact</header>
  <main><article class="post">Built a C++ compiler with lexical analysis.</article></main>
  <footer id="foot">copyright 2026</footer>
</body></html>
"""


def test_drop_selectors_remove_chrome():
    rule = ExtractionRule(source_id="x", drop_selectors=["header.nav", "#foot"])
    text = apply_rules(_HTML, rule)
    assert "C++ compiler" in text
    assert "Home About" not in text
    assert "copyright" not in text


def test_keep_selectors_restrict_to_content():
    rule = ExtractionRule(source_id="x", keep_selectors=["article.post"])
    text = apply_rules(_HTML, rule)
    assert text.strip() == "Built a C++ compiler with lexical analysis."


def test_empty_rule_keeps_all_text():
    text = apply_rules(_HTML, ExtractionRule(source_id="x"))
    assert "C++ compiler" in text and "Home About" in text


def test_keep_regex_filters_lines():
    rule = ExtractionRule(source_id="x", keep_regex=["C\\+\\+"])
    text = apply_rules(_HTML, rule)
    assert "C++ compiler" in text
    assert "copyright" not in text


def test_garbage_html_returns_empty():
    assert apply_rules("", ExtractionRule(source_id="x")) == ""


def test_malformed_keep_regex_does_not_raise():
    rule = ExtractionRule(source_id="x", keep_regex=["[unclosed"])
    text = apply_rules(_HTML, rule)  # malformed pattern must not raise
    assert "C++ compiler" in text  # falls back to unfiltered content


_PAGE = "<html><body><header class='nav'>Menu</header><main><p>Project X does Y.</p></main></body></html>"
_PAGE_SAME_SHAPE = _PAGE.replace("Project X does Y.", "Project Z does W.")
_PAGE_DIFF = "<html><body><section><h1>Title</h1></section></body></html>"


class _FakeLLM:
    def __init__(self):
        self.calls = 0

    def structured(self, prompt, schema, system=None, max_tokens=2048):
        self.calls += 1
        return schema(source_id="placeholder", drop_selectors=["header.nav"])


def test_engine_caches_by_fingerprint():
    llm = _FakeLLM()
    engine = ExtractionRuleEngine(llm)
    r1 = engine.rules_for("u1", _PAGE)
    r2 = engine.rules_for("u2", _PAGE_SAME_SHAPE)  # same shape → cache hit
    assert llm.calls == 1
    assert r1.drop_selectors == ["header.nav"]
    assert r2.drop_selectors == ["header.nav"]
    assert r2.source_id == "u2"  # cache hit must carry the current caller's source_id
    assert r1.source_id == "u1"  # cache hit returns a copy; the first caller's rule is untouched
    engine.rules_for("u3", _PAGE_DIFF)  # new shape → new call
    assert llm.calls == 2


def test_engine_sets_source_id_on_returned_rule():
    engine = ExtractionRuleEngine(_FakeLLM())
    rule = engine.rules_for("owner/repo", _PAGE)
    assert rule.source_id == "owner/repo"


def test_engine_falls_back_to_empty_rule_on_llm_error():
    class _BoomLLM:
        def structured(self, *a, **k):
            raise RuntimeError("boom")

    rule = ExtractionRuleEngine(_BoomLLM()).rules_for("x", _PAGE)
    assert rule.drop_selectors == [] and rule.keep_selectors == []
