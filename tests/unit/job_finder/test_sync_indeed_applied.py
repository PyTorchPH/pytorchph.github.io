from datetime import date

import pytest

from tools.job_finder.sync_indeed_applied import _parse_applied_date


def test_parse_applied_today():
    assert _parse_applied_date("Applied today on Indeed", date(2026, 7, 24)) == date(2026, 7, 24)


def test_parse_previous_weekday():
    assert _parse_applied_date("Applied on Indeed on Tuesday", date(2026, 7, 24)) == date(
        2026, 7, 21
    )


def test_parse_same_weekday_means_previous_week():
    assert _parse_applied_date("Applied on Indeed on Friday", date(2026, 7, 24)) == date(
        2026, 7, 17
    )


def test_parse_visible_month_and_day():
    assert _parse_applied_date("Applied on Indeed on Jul 21", date(2026, 8, 8)) == date(
        2026, 7, 21
    )


def test_parse_visible_month_and_day_rolls_to_previous_year():
    assert _parse_applied_date("Applied on Indeed on Dec 30", date(2026, 1, 3)) == date(
        2025, 12, 30
    )


def test_parse_unknown_label_fails_closed():
    with pytest.raises(ValueError, match="unsupported Indeed application date"):
        _parse_applied_date("Applied recently", date(2026, 7, 24))
