"""playwright_step: slow, visible per-post walk that highlights (never deletes) DOM."""

from __future__ import annotations

from unittest.mock import MagicMock

from resume_builder.sources.social.playwright_step import (
    step_delay_ms_from_env,
    step_limit_from_env,
    step_through_articles,
)


def test_step_limit_defaults_to_zero(monkeypatch):
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_STEP_LIMIT", raising=False)
    assert step_limit_from_env() == 0


def test_step_limit_reads_env(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_STEP_LIMIT", "3")
    assert step_limit_from_env() == 3


def test_step_limit_ignores_garbage(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_STEP_LIMIT", "not-a-number")
    assert step_limit_from_env() == 0


def test_step_delay_defaults_to_5000(monkeypatch):
    monkeypatch.delenv("RESUME_BUILD_PLAYWRIGHT_STEP_DELAY_MS", raising=False)
    assert step_delay_ms_from_env() == 5000


def test_step_delay_reads_env(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_STEP_DELAY_MS", "8000")
    assert step_delay_ms_from_env() == 8000


def test_step_through_walks_only_the_limit(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    page = MagicMock()
    articles = [MagicMock(name=f"article-{i}") for i in range(5)]
    page.query_selector_all.return_value = articles

    stepped = step_through_articles(page, "sel", limit=2)

    assert stepped == 2
    assert articles[0].evaluate.called
    assert articles[1].evaluate.called
    assert not articles[2].evaluate.called


def test_step_through_is_noop_when_limit_zero(monkeypatch):
    page = MagicMock()
    articles = [MagicMock()]
    page.query_selector_all.return_value = articles

    stepped = step_through_articles(page, "sel", limit=0)

    assert stepped == 0
    assert not articles[0].evaluate.called


def test_step_through_highlights_comments_without_deleting(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    page = MagicMock()
    article = MagicMock()
    page.query_selector_all.return_value = [article]

    step_through_articles(page, "sel", limit=1)

    # Comments are found by the authoritative aria-label="Comment by ..." signal and
    # drawn via the overlay box-drawer — never removed from the DOM.
    joined = " ".join(str(c.args[0]) for c in article.evaluate.call_args_list).lower()
    assert "comment by" in joined
    assert "reply by" in joined
    assert "__rbbox" in joined  # overlay draw, not node.remove()
    assert ".remove()" not in joined  # non-destructive: nothing is deleted


def test_step_through_highlights_media_and_preserves_shared(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    page = MagicMock()
    article = MagicMock()
    page.query_selector_all.return_value = [article]

    step_through_articles(page, "sel", limit=1)

    joined = " ".join(str(c.args[0]) for c in article.evaluate.call_args_list).lower()
    # Media is highlighted (img/video) and shared posts are explicitly preserved.
    assert "img" in joined and "video" in joined
    assert "shared (preserved)" in joined


def test_step_through_boxes_picture_and_text_as_separate_regions(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    page = MagicMock()
    article = MagicMock()
    page.query_selector_all.return_value = [article]

    step_through_articles(page, "sel", limit=1)

    joined = " ".join(str(c.args[0]) for c in article.evaluate.call_args_list)
    # Picture and text are retrieved as two distinct, separately-boxed regions.
    assert "retrieve picture" in joined
    assert "retrieve text" in joined
    # Text is boxed on the caption blocks (div[dir="auto"]), NOT the whole post — so the
    # green text region never overlaps the picture region.
    assert 'div[dir="auto"]' in joined


def test_step_through_renders_the_hud(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    page = MagicMock()
    article = MagicMock()
    page.query_selector_all.return_value = [article]

    step_through_articles(page, "sel", limit=1)

    # The side HUD is driven through page.evaluate with the __rbHud renderer.
    page_js = " ".join(str(c.args[0]) for c in page.evaluate.call_args_list)
    assert "__rbHud" in page_js or "__rbBox" in page_js


def test_step_through_handles_more_articles_than_exist(monkeypatch):
    monkeypatch.setenv("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    page = MagicMock()
    articles = [MagicMock(), MagicMock()]
    page.query_selector_all.return_value = articles

    stepped = step_through_articles(page, "sel", limit=10)

    assert stepped == 2
