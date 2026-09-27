"""scroll_collect: scroll until item count plateaus, then return all items."""

from __future__ import annotations

from unittest.mock import MagicMock

from resume_builder.sources.social.headless_browser import scroll_collect


def _make_page(item_counts_per_call: list[int]):
    """Return a fake Playwright page whose query_selector_all yields growing lists
    of dummy elements following the supplied count schedule.
    """
    page = MagicMock()
    pool: list[MagicMock] = []
    schedule = iter(item_counts_per_call)

    def _qsall(_selector: str):
        try:
            target = next(schedule)
        except StopIteration:
            target = len(pool)
        while len(pool) < target:
            pool.append(MagicMock(name=f"item-{len(pool)}"))
        return list(pool[:target])

    page.query_selector_all.side_effect = _qsall
    return page


def test_collects_growing_feed_then_stops():
    # 3, 5, 7, 7, 7 — should stop after the third plateau (no_growth_passes=3).
    page = _make_page([3, 5, 7, 7, 7, 7, 7])
    results = scroll_collect(
        page, "div[role='article']", max_scrolls=10, settle_ms=0, no_growth_passes=3
    )
    assert len(results) == 7
    # Ensures evaluate was called to actually scroll.
    assert page.evaluate.called


def test_max_scrolls_caps_the_loop():
    # Always returning 1 means the feed never plateaus by the no_growth threshold
    # within 2 scrolls; max_scrolls must bound the loop.
    page = _make_page([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    results = scroll_collect(
        page,
        "div[role='article']",
        max_scrolls=2,
        settle_ms=0,
        no_growth_passes=99,
    )
    # Returns whatever's there after the loop exits.
    assert len(results) == 1
    assert page.evaluate.call_count <= 2


def test_handles_zero_items_gracefully():
    page = _make_page([0, 0, 0, 0])
    results = scroll_collect(
        page, "div[role='article']", max_scrolls=5, settle_ms=0, no_growth_passes=3
    )
    assert results == []
