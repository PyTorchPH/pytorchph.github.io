from __future__ import annotations

import base64

import pytest

from resume_builder.extraction.github_traversal import (
    collect_repo_code,
    collect_repo_markdown,
    collect_repo_readme,
    gather_repo_sources,
)


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _fake_gh_json(calls):
    tree = {
        "tree": [
            {"path": "README.md", "type": "blob"},
            {"path": "sub/README.md", "type": "blob"},
            {"path": "docs/ARCH.md", "type": "blob"},
            {"path": "src/main.py", "type": "blob"},   # ignored (not md/readme)
            {"path": "docs", "type": "tree"},          # ignored (not a blob)
        ]
    }
    bodies = {
        "README.md": "# Title\n<!-- comment -->\n![badge](x.png)\nReal text.",
        "sub/README.md": "Sub readme content.",
        "docs/ARCH.md": "Architecture notes.",
    }

    def gh_json(args):
        calls.append(args)
        joined = " ".join(args)
        if "git/trees" in joined:
            return tree
        for path, body in bodies.items():
            if joined.endswith(f"contents/{path}"):
                return {"content": _b64(body)}
        return None

    return gh_json


def test_collects_all_readmes_and_docs_md():
    sources = collect_repo_markdown("owner/repo", _fake_gh_json([]))
    paths = {s.title for s in sources}
    assert paths == {"README.md", "sub/README.md", "docs/ARCH.md"}
    assert all(s.kind == "github_readme" for s in sources)
    assert any(s.source_id == "owner/repo:README.md" for s in sources)


def test_markdown_noise_is_stripped():
    sources = collect_repo_markdown("owner/repo", _fake_gh_json([]))
    root = next(s for s in sources if s.title == "README.md")
    assert "Real text." in root.text
    assert "<!--" not in root.text and "badge" not in root.text


def test_tree_failure_returns_empty():
    assert collect_repo_markdown("owner/repo", lambda args: None) == []


def test_badge_links_are_stripped():
    body = "Intro [![CI](https://img.shields.io/badge/ci-pass)](https://github.com) done."
    tree = {"tree": [{"path": "README.md", "type": "blob"}]}

    def gh_json(args):
        joined = " ".join(args)
        if "git/trees" in joined:
            return tree
        if joined.endswith("contents/README.md"):
            return {"content": _b64(body)}
        return None

    sources = collect_repo_markdown("owner/repo", gh_json)
    text = sources[0].text
    assert "shields.io" not in text and "img.shields" not in text
    assert "Intro" in text and "done." in text


def test_blob_fetch_exception_skips_only_that_file():
    tree = {"tree": [
        {"path": "README.md", "type": "blob"},
        {"path": "docs/A.md", "type": "blob"},
    ]}

    def gh_json(args):
        joined = " ".join(args)
        if "git/trees" in joined:
            return tree
        if joined.endswith("contents/README.md"):
            raise RuntimeError("blob boom")
        if joined.endswith("contents/docs/A.md"):
            return {"content": _b64("Docs body.")}
        return None

    sources = collect_repo_markdown("owner/repo", gh_json)
    assert {s.title for s in sources} == {"docs/A.md"}  # README skipped, docs/A.md survived


def test_large_source_is_capped_and_flagged():
    big = "A" * 5000
    tree = {"tree": [{"path": "README.md", "type": "blob"}]}

    def gh_json(args):
        joined = " ".join(args)
        if "git/trees" in joined:
            return tree
        if joined.endswith("contents/README.md"):
            return {"content": _b64(big)}
        return None

    sources = collect_repo_markdown("owner/repo", gh_json, cap_chars=100)
    assert len(sources[0].text) <= 100 and sources[0].truncated is True


def test_max_files_bounds_collection():
    tree = {"tree": [{"path": f"docs/D{i}.md", "type": "blob"} for i in range(5)]}

    def gh_json(args):
        joined = " ".join(args)
        if "git/trees" in joined:
            return tree
        return {"content": _b64("body")}

    sources = collect_repo_markdown("owner/repo", gh_json, max_files=3)
    assert len(sources) == 3


def _mixed_gh_json():
    """Tree with a root README, a nested README, a doc, a code file, and a vendored file."""
    tree = {
        "tree": [
            {"path": "README.md", "type": "blob"},
            {"path": "sub/README.md", "type": "blob"},
            {"path": "docs/ARCH.md", "type": "blob"},
            {"path": "src/main.py", "type": "blob"},
            {"path": "node_modules/lib/index.js", "type": "blob"},  # vendored -> skipped by code
        ]
    }

    def gh_json(args):
        joined = " ".join(args)
        if "git/trees" in joined:
            return tree
        return {"content": _b64(f"body of {joined.rsplit('contents/', 1)[-1]}")}

    return gh_json


def test_collect_repo_readme_returns_only_root_readme():
    sources = collect_repo_readme("owner/repo", _mixed_gh_json())
    assert [s.title for s in sources] == ["README.md"]  # not sub/README.md, not docs


def test_collect_repo_code_keeps_source_skips_vendored():
    sources = collect_repo_code("owner/repo", _mixed_gh_json())
    titles = {s.title for s in sources}
    assert titles == {"src/main.py"}  # code kept; node_modules skipped; markdown not code
    assert all(s.kind == "github_code" for s in sources)


def test_gather_depth_readme_markdown_code():
    readme = gather_repo_sources("owner/repo", _mixed_gh_json(), depth="readme")
    assert {s.title for s in readme} == {"README.md"}

    markdown = gather_repo_sources("owner/repo", _mixed_gh_json(), depth="markdown")
    assert {s.title for s in markdown} == {"README.md", "sub/README.md", "docs/ARCH.md"}

    code = gather_repo_sources("owner/repo", _mixed_gh_json(), depth="code")
    titles = {s.title for s in code}
    assert {"README.md", "docs/ARCH.md", "src/main.py"} <= titles  # markdown + code combined


def test_gather_invalid_depth_raises():
    with pytest.raises(ValueError):
        gather_repo_sources("owner/repo", _mixed_gh_json(), depth="everything")
