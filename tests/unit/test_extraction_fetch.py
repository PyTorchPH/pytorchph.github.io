from __future__ import annotations

from resume_builder.extraction.fetch import SourceFetcher

_RICH = "<html><body><article>" + ("Real content. " * 40) + "</article></body></html>"
_THIN = "<html><body><div id='root'></div></body></html>"


def test_static_rich_page_no_fallback():
    f = SourceFetcher(http_get=lambda u: _RICH, headless_fetch=lambda u: "SHOULD_NOT_RUN")
    html, degraded = f.fetch("http://x")
    assert "Real content" in html and degraded is False


def test_thin_page_escalates_to_headless():
    f = SourceFetcher(http_get=lambda u: _THIN, headless_fetch=lambda u: _RICH)
    html, degraded = f.fetch("http://x")
    assert "Real content" in html and degraded is True


def test_thin_page_no_headless_returns_degraded():
    f = SourceFetcher(http_get=lambda u: _THIN, headless_fetch=None)
    html, degraded = f.fetch("http://x")
    assert html == _THIN and degraded is True


def test_headless_failure_keeps_static():
    def boom(_u):
        raise RuntimeError("no browser")

    f = SourceFetcher(http_get=lambda u: _THIN, headless_fetch=boom)
    html, degraded = f.fetch("http://x")
    assert html == _THIN and degraded is True


def test_injected_get_raising_does_not_propagate():
    def boom(_u):
        raise RuntimeError("get failed")

    f = SourceFetcher(http_get=boom, headless_fetch=None)
    html, degraded = f.fetch("http://x")
    assert html == "" and degraded is True
