"""Tests for the aggregate usage counters (downloads, pages scraped).

Includes a deterministic demonstration of the known lost-update race condition so
the documented limitation is captured in the test suite, not just in prose.
"""
from __future__ import annotations

import pytest

from resume_builder.metrics.usage_counter import (
    add_pages_scraped,
    bump_download,
    increment,
    read_counters,
)


def test_missing_file_reads_as_zero(tmp_path):
    counters = read_counters(tmp_path / "nope.json")
    assert counters.downloads == 0
    assert counters.pages_scraped == 0


def test_bump_download_persists_and_accumulates(tmp_path):
    path = tmp_path / "c.json"
    assert bump_download(path).downloads == 1
    assert bump_download(path).downloads == 2
    # survives a fresh read from disk
    assert read_counters(path).downloads == 2


def test_add_pages_scraped_adds_n(tmp_path):
    path = tmp_path / "c.json"
    assert add_pages_scraped(5, path).pages_scraped == 5
    assert add_pages_scraped(3, path).pages_scraped == 8
    # the two counters are independent
    assert read_counters(path).downloads == 0


def test_unknown_field_is_rejected(tmp_path):
    with pytest.raises(ValueError):
        increment("hax", 1, tmp_path / "c.json")


def test_negative_increment_is_rejected(tmp_path):
    with pytest.raises(ValueError):
        increment("downloads", -1, tmp_path / "c.json")


def test_corrupt_file_reads_as_zero_not_crash(tmp_path):
    path = tmp_path / "c.json"
    path.write_text("{ this is not json", encoding="utf-8")
    assert read_counters(path).downloads == 0


def test_lost_update_race_is_real_when_reads_interleave(tmp_path):
    """KNOWN LIMITATION: read-modify-write loses updates under concurrency.

    Reproduced deterministically: a writer holding a stale snapshot clobbers a
    committed increment. This is the behaviour the GitHub Projects backlog item
    'Make usage counters concurrency-safe (atomic increment)' will fix.
    """
    path = tmp_path / "c.json"
    bump_download(path)  # downloads = 1

    # Two requests both read downloads = 1 (the race window).
    stale = read_counters(path)
    bump_download(path)  # writer A commits -> downloads = 2

    # Writer B still holds the stale snapshot and writes stale + 1 = 2,
    # overwriting A's increment instead of producing 3.
    path.write_text(
        stale.model_copy(update={"downloads": stale.downloads + 1}).model_dump_json(),
        encoding="utf-8",
    )

    assert read_counters(path).downloads == 2  # A's +1 was lost (would be 3 if safe)
