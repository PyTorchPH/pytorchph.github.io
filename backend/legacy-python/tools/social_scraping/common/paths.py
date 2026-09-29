"""Shared path resolution for the scratch automation tools under ``tools/``.

These scripts are run directly (``python tools/.../foo.py``) from anywhere, so they
can't rely on the current working directory or on ``tools/`` being importable. Each
script bootstraps with::

    import sys
    from pathlib import Path
    ROOT = next(p for p in Path(__file__).resolve().parents if (p / "pyproject.toml").exists())
    sys.path.insert(0, str(ROOT / "tools"))
    sys.path.insert(0, str(ROOT / "legacy" / "python"))
    from social_scraping.common.paths import OUT, DATA, MEDIA, SHOTS, RESUMES, DIAGNOSTICS

then uses the resolved artifact directories below.
"""

from __future__ import annotations

from pathlib import Path


def repo_root() -> Path:
    """Walk up from this file to the directory containing ``pyproject.toml``."""
    here = Path(__file__).resolve()
    for parent in (here, *here.parents):
        if (parent / "pyproject.toml").exists():
            return parent
    return Path.cwd()


ROOT: Path = repo_root()
SRC: Path = ROOT / "legacy" / "python"

OUT: Path = ROOT / "out"
DATA: Path = OUT / "data"
DIAGNOSTICS: Path = DATA / "diagnostics"
MEDIA: Path = OUT / "media"
SHOTS: Path = OUT / "screenshots"
RESUMES: Path = OUT / "resumes"

# Per-surface convenience paths.
FB_JSON: Path = DATA / "facebook.json"
LI_JSON: Path = DATA / "linkedin.json"
FB_MEDIA: Path = MEDIA / "facebook"
FB_SHOTS: Path = SHOTS / "facebook"
LI_SHOTS: Path = SHOTS / "linkedin"


def ensure_dirs() -> None:
    for d in (DATA, DIAGNOSTICS, MEDIA, SHOTS, RESUMES, FB_MEDIA, FB_SHOTS, LI_SHOTS):
        d.mkdir(parents=True, exist_ok=True)
