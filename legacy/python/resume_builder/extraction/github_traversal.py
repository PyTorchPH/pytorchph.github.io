"""GitHub repo source collection at three scan depths.

A shared blob-collection core (`_collect_blobs`) walks the repo git-tree once and
emits token-capped, bounded `CleanedSource`s. Three public collectors sit on top:

- `collect_repo_readme`  — the root README only (lightest; smallest token budget).
- `collect_repo_markdown` — every README.* + docs/*.md (mid context).
- `collect_repo_code`     — relevant source files, skipping vendored/build dirs (richest).

`gather_repo_sources(..., depth=...)` is the user-facing selector: a caller picks the
depth that matches the capability of the model they will feed (`SCAN_DEPTHS`).
"""

from __future__ import annotations

import base64
import logging
import re
from typing import Callable

from .models import DEFAULT_CAP_CHARS, CleanedSource, apply_token_cap

log = logging.getLogger(__name__)

#: User-selectable scan depths, lightest -> richest.
SCAN_DEPTHS: tuple[str, ...] = ("readme", "markdown", "code")

_README_ROOT = re.compile(r"^README\.[^/]+$", re.IGNORECASE)
_MD_KEEP = re.compile(r"(^|/)README\.[^/]+$|^docs/.*\.md$", re.IGNORECASE)
_CODE_EXT = re.compile(
    r"\.(py|js|jsx|ts|tsx|java|kt|kts|c|cc|cpp|cxx|h|hpp|cs|go|rs|rb|php|swift|m|mm|"
    r"scala|sh|ps1|sql)$",
    re.IGNORECASE,
)
_SKIP_DIR = re.compile(
    r"(^|/)(node_modules|dist|build|out|target|vendor|\.venv|venv|env|__pycache__|"
    r"\.git|coverage|\.next|\.cache|migrations|generated)/",
    re.IGNORECASE,
)

GhJson = Callable[[list[str]], object]


def _strip_md_noise(text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)            # HTML comments
    text = re.sub(r"\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)", "", text)      # badge links
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)                   # images
    text = re.sub(r"<[^>]+>", "", text)                               # raw html tags
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _identity(text: str) -> str:
    return text.strip()


def _collect_blobs(
    full_name: str,
    gh_json: GhJson,
    keep: Callable[[str], bool],
    kind: str,
    *,
    ref: str,
    cap_chars: int,
    max_files: int,
    normalize: Callable[[str], str],
) -> list[CleanedSource]:
    """Walk the repo git-tree once; emit capped, bounded CleanedSources. Never raises."""
    try:
        tree = gh_json(["api", f"repos/{full_name}/git/trees/{ref}?recursive=1"]) or {}
    except Exception as exc:  # noqa: BLE001
        log.warning("git-tree fetch failed for %s: %s", full_name, exc)
        return []
    out: list[CleanedSource] = []
    for node in (tree.get("tree", []) if isinstance(tree, dict) else []):
        if len(out) >= max_files:
            break
        path = node.get("path", "")
        if node.get("type") != "blob" or not keep(path):
            continue
        try:
            blob = gh_json(["api", f"repos/{full_name}/contents/{path}"]) or {}
            raw = base64.b64decode(blob.get("content", "")).decode("utf-8", "replace")
        except Exception as exc:  # noqa: BLE001
            log.warning("blob fetch failed for %s/%s: %s", full_name, path, exc)
            continue
        if not raw.strip():
            continue
        capped, truncated = apply_token_cap(normalize(raw), cap_chars)
        out.append(
            CleanedSource(
                source_id=f"{full_name}:{path}",
                kind=kind,
                title=path,
                text=capped,
                section_hints=[path],
                truncated=truncated,
            )
        )
    return out


def collect_repo_readme(
    full_name: str,
    gh_json: GhJson,
    ref: str = "HEAD",
    cap_chars: int = DEFAULT_CAP_CHARS,
) -> list[CleanedSource]:
    """Lightest depth: the root README only (e.g. README.md / README.rst)."""
    return _collect_blobs(
        full_name, gh_json, lambda p: bool(_README_ROOT.match(p)), "github_readme",
        ref=ref, cap_chars=cap_chars, max_files=1, normalize=_strip_md_noise,
    )


def collect_repo_markdown(
    full_name: str,
    gh_json: GhJson,
    ref: str = "HEAD",
    cap_chars: int = DEFAULT_CAP_CHARS,
    max_files: int = 50,
) -> list[CleanedSource]:
    """Mid depth: every README.* + docs/*.md, light-normalized and capped (spec 6)."""
    return _collect_blobs(
        full_name, gh_json, lambda p: bool(_MD_KEEP.search(p)), "github_readme",
        ref=ref, cap_chars=cap_chars, max_files=max_files, normalize=_strip_md_noise,
    )


def collect_repo_code(
    full_name: str,
    gh_json: GhJson,
    ref: str = "HEAD",
    cap_chars: int = DEFAULT_CAP_CHARS,
    max_files: int = 40,
) -> list[CleanedSource]:
    """Richest depth: relevant source files, skipping vendored/build/generated dirs."""

    def keep(path: str) -> bool:
        return bool(_CODE_EXT.search(path)) and not _SKIP_DIR.search(path)

    return _collect_blobs(
        full_name, gh_json, keep, "github_code",
        ref=ref, cap_chars=cap_chars, max_files=max_files, normalize=_identity,
    )


def gather_repo_sources(
    full_name: str,
    gh_json: GhJson,
    depth: str = "markdown",
    ref: str = "HEAD",
    cap_chars: int = DEFAULT_CAP_CHARS,
) -> list[CleanedSource]:
    """User-facing depth selector. ``depth`` is one of ``SCAN_DEPTHS``.

    - ``readme``   -> root README only (cheapest; for weak/small models)
    - ``markdown`` -> all README.* + docs/*.md (default)
    - ``code``     -> markdown PLUS relevant source files (richest; for strong models)
    """
    if depth not in SCAN_DEPTHS:
        raise ValueError(f"Unknown scan depth {depth!r}; expected one of {SCAN_DEPTHS}.")
    if depth == "readme":
        return collect_repo_readme(full_name, gh_json, ref=ref, cap_chars=cap_chars)
    if depth == "code":
        return collect_repo_markdown(full_name, gh_json, ref=ref, cap_chars=cap_chars) + \
            collect_repo_code(full_name, gh_json, ref=ref, cap_chars=cap_chars)
    return collect_repo_markdown(full_name, gh_json, ref=ref, cap_chars=cap_chars)
