from __future__ import annotations

import os
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault(
    "HYPOTHESIS_STORAGE_DIRECTORY",
    str(PROJECT_ROOT / "var" / "cache" / "test-tools" / "hypothesis"),
)

# Disable live browser-cookie scanning in tests; per-test fixtures can set their own.
os.environ.setdefault("RESUME_BUILDER_NO_BROWSER_COOKIES", "1")
# Isolate the session-store cache so tests don't pick up real cookies.
os.environ.setdefault(
    "RESUME_BUILDER_CACHE",
    str(PROJECT_ROOT / "var" / "cache" / "test-tools" / "pytest" / "social-cache"),
)


@pytest.fixture
def project_root() -> Path:
    return PROJECT_ROOT


@pytest.fixture
def config_dir(project_root: Path) -> Path:
    return project_root / "config"


@pytest.fixture
def templates_dir(config_dir: Path) -> Path:
    return config_dir / "templates"
