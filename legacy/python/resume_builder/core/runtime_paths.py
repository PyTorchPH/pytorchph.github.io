"""Repository-local runtime and review-artifact path policy."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
VAR_ROOT = Path(os.environ.get("PYTORCH_PH_VAR_ROOT", REPO_ROOT / "var")).resolve()
ARTIFACT_ROOT = Path(
    os.environ.get("PYTORCH_PH_ARTIFACT_ROOT", REPO_ROOT / "out")
).resolve()


def var_path(*parts: str) -> Path:
    return VAR_ROOT.joinpath(*parts)


def artifact_path(*parts: str) -> Path:
    return ARTIFACT_ROOT.joinpath(*parts)
