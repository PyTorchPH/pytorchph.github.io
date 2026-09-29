"""--step flag wiring: _apply_step_env sets the step-mode environment."""

from __future__ import annotations

import os

import pytest

from resume_builder.commands.scrape_cmd import _apply_step_env

_STEP_ENV = (
    "RESUME_BUILD_PLAYWRIGHT_VISUAL",
    "RESUME_BUILD_PLAYWRIGHT_STEP_LIMIT",
    "RESUME_BUILD_PLAYWRIGHT_STEP_DELAY_MS",
)


@pytest.fixture(autouse=True)
def _isolate_step_env():
    """`_apply_step_env` writes os.environ directly (as it does at runtime), so
    snapshot and fully restore these keys around each test to avoid leaking
    RESUME_BUILD_PLAYWRIGHT_VISUAL into sibling tests."""
    saved = {key: os.environ.get(key) for key in _STEP_ENV}
    for key in _STEP_ENV:
        os.environ.pop(key, None)
    try:
        yield
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_apply_step_env_sets_visual_limit_and_delay():
    _apply_step_env(True, None)

    assert os.environ["RESUME_BUILD_PLAYWRIGHT_VISUAL"] == "1"
    assert os.environ["RESUME_BUILD_PLAYWRIGHT_STEP_LIMIT"] == "3"
    assert os.environ["RESUME_BUILD_PLAYWRIGHT_STEP_DELAY_MS"] == "5000"


def test_apply_step_env_respects_explicit_limit():
    _apply_step_env(True, 1)

    assert os.environ["RESUME_BUILD_PLAYWRIGHT_STEP_LIMIT"] == "1"


def test_apply_step_env_noop_when_off():
    _apply_step_env(False, None)

    assert "RESUME_BUILD_PLAYWRIGHT_STEP_LIMIT" not in os.environ
    assert "RESUME_BUILD_PLAYWRIGHT_VISUAL" not in os.environ
