# P2 — Website-Agnostic Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a token-lean, website-agnostic extraction layer that turns raw GitHub READMEs and arbitrary web pages into clean `CleanedSource` text for the P3 tagging pipeline.

**Architecture:** A small `resume_builder.extraction` package. HTML pages go through a *structure-skeleton pass* — a cheap DOM outline is sent to the LLM, which returns keep/drop selectors + regex; a deterministic applier extracts only the kept text; rules are cached by a DOM-shape fingerprint. GitHub repos are traversed for all `README.*` + `docs/*.md` (markdown, light-normalized). Everything is bounded and falls back gracefully.

**Tech Stack:** Python 3.11+, pydantic v2, lxml (HTML parse — already a dep), requests (static fetch), Playwright (headless fallback — already a dep), `gh` CLI (git-tree traversal), pytest + pytest-mock.

## Global Constraints

- Python `>=3.11`; pydantic `>=2.7`; line-length 100; `from __future__ import annotations` in every module.
- **No new dependencies.** Use only lxml / requests / Playwright / `gh` (already present). No bs4, cssselect, readability, trafilatura.
- The only LLM-touching unit is `ExtractionRuleEngine`, behind the existing `LLMProvider` ABC (`resume_builder.llm.base`) so it is mockable in tests.
- Reuse, do not redefine: `ExtractionRule` (`resume_builder.industry`), the `gh api` JSON seam pattern (`resume_builder.sources.github.GitHubSource._gh_json`), Playwright runtime (`resume_builder.sources.social`).
- Token budget is approximated as `chars / 4`. `DEFAULT_TOKEN_CAP = 3000` tokens → `DEFAULT_CAP_CHARS = 12000`.
- All units degrade (return empty/short with a flag), never raise, on fetch/parse/LLM failure.
- Tests are offline: mock the LLM, mock `gh_json`, use saved HTML fixtures. No live network.

---

## File Structure

| File | Responsibility |
|---|---|
| `legacy/python/resume_builder/extraction/__init__.py` | Public API re-exports (`CleanedSource`, `extract_website`, `collect_repo_markdown`, `ExtractionRuleEngine`, `SourceFetcher`). |
| `legacy/python/resume_builder/extraction/models.py` | `CleanedSource` model + token-cap constants. |
| `legacy/python/resume_builder/extraction/skeleton.py` | `build_skeleton(html)` + `template_fingerprint(html)`. |
| `legacy/python/resume_builder/extraction/rules.py` | CSS-subset matcher, `apply_rules(html, rule)`, `ExtractionRuleEngine`. |
| `legacy/python/resume_builder/extraction/fetch.py` | `SourceFetcher` (static-first + headless fallback + thinness heuristic). |
| `legacy/python/resume_builder/extraction/github_traversal.py` | `collect_repo_markdown(full_name, gh_json)` (README.* + docs/*.md). |
| `legacy/python/resume_builder/extraction/web.py` | `extract_website(url, fetcher, engine, ...)` orchestrator. |
| `tests/unit/test_extraction_skeleton.py` | skeleton + fingerprint tests. |
| `tests/unit/test_extraction_rules.py` | matcher, `apply_rules`, engine cache tests. |
| `tests/unit/test_extraction_fetch.py` | static/headless/thinness tests. |
| `tests/unit/test_extraction_github.py` | markdown traversal tests. |
| `tests/unit/test_extraction_web.py` | orchestrator + token-cap tests. |

---

### Task 1: `CleanedSource` model + package scaffold

**Files:**
- Create: `legacy/python/resume_builder/extraction/__init__.py`
- Create: `legacy/python/resume_builder/extraction/models.py`
- Test: `tests/unit/test_extraction_skeleton.py` (shared module file, first test lands here in Task 2; this task tests the model inline)
- Test: `tests/unit/test_extraction_models.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `CleanedSource(source_id: str, kind: str, title: str = "", text: str = "", section_hints: list[str] = [], truncated: bool = False, degraded: bool = False)`; constants `CHARS_PER_TOKEN = 4`, `DEFAULT_TOKEN_CAP = 3000`, `DEFAULT_CAP_CHARS = 12000`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_extraction_models.py
from resume_builder.extraction.models import CleanedSource, DEFAULT_CAP_CHARS


def test_cleaned_source_defaults():
    cs = CleanedSource(source_id="owner/repo:README.md", kind="github_readme")
    assert cs.text == ""
    assert cs.section_hints == []
    assert cs.truncated is False and cs.degraded is False


def test_cap_chars_constant():
    assert DEFAULT_CAP_CHARS == 12000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_models.py -v`
Expected: FAIL with `ModuleNotFoundError: resume_builder.extraction`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/extraction/__init__.py
"""P2 — website-agnostic extraction package."""
from __future__ import annotations

from .models import CleanedSource, CHARS_PER_TOKEN, DEFAULT_TOKEN_CAP, DEFAULT_CAP_CHARS

__all__ = ["CleanedSource", "CHARS_PER_TOKEN", "DEFAULT_TOKEN_CAP", "DEFAULT_CAP_CHARS"]
```

```python
# legacy/python/resume_builder/extraction/models.py
from __future__ import annotations

from pydantic import BaseModel, Field

CHARS_PER_TOKEN = 4
DEFAULT_TOKEN_CAP = 3000
DEFAULT_CAP_CHARS = DEFAULT_TOKEN_CAP * CHARS_PER_TOKEN


class CleanedSource(BaseModel):
    """Normalized, token-lean output of P2, consumed by P3 (tagging)."""

    source_id: str
    kind: str  # "github_readme" | "github_code" | "website"
    title: str = ""
    text: str = ""
    section_hints: list[str] = Field(default_factory=list)
    truncated: bool = False
    degraded: bool = False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_models.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/extraction/__init__.py legacy/python/resume_builder/extraction/models.py tests/unit/test_extraction_models.py
git commit -m "feat(extraction): CleanedSource model + package scaffold"
```

---

### Task 2: DOM skeleton + template fingerprint

**Files:**
- Create: `legacy/python/resume_builder/extraction/skeleton.py`
- Test: `tests/unit/test_extraction_skeleton.py`

**Interfaces:**
- Consumes: nothing (pure functions over HTML strings).
- Produces: `build_skeleton(html: str, max_nodes: int = 400) -> str`; `template_fingerprint(html: str, max_nodes: int = 200) -> str`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_extraction_skeleton.py
from resume_builder.extraction.skeleton import build_skeleton, template_fingerprint

_HTML_A = """
<html><body>
  <header id="top" class="site-nav">Logo Home About</header>
  <main role="main"><article class="post">Real project content here.</article></main>
  <footer>copyright</footer>
</body></html>
"""

# same shape (tags + id/class), different text → identical fingerprint
_HTML_A2 = _HTML_A.replace("Real project content here.", "Totally different words.")
# different shape → different fingerprint
_HTML_B = "<html><body><div class='x'><p>hi</p></div></body></html>"


def test_skeleton_keeps_structure_drops_long_text():
    sk = build_skeleton(_HTML_A)
    assert "header#top.site-nav" in sk
    assert "article.post" in sk
    assert "[role=main]" in sk
    # text is truncated/stripped, not dumped wholesale
    assert "Real project content here." not in sk or "«Real project content" in sk


def test_fingerprint_ignores_text_but_tracks_shape():
    assert template_fingerprint(_HTML_A) == template_fingerprint(_HTML_A2)
    assert template_fingerprint(_HTML_A) != template_fingerprint(_HTML_B)


def test_skeleton_handles_garbage():
    assert build_skeleton("") == ""
    assert template_fingerprint("") == "empty"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_skeleton.py -v`
Expected: FAIL with `ModuleNotFoundError` / `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/extraction/skeleton.py
from __future__ import annotations

import hashlib

import lxml.html

_SKELETON_TEXT_MAX = 40


def _parse(html: str):
    try:
        return lxml.html.fromstring(html)
    except Exception:
        return None


def build_skeleton(html: str, max_nodes: int = 400) -> str:
    """Compact structural outline: tag + #id/.class/[role], text stripped/truncated."""
    root = _parse(html)
    if root is None:
        return ""
    lines: list[str] = []
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        token = el.tag
        if el.get("id"):
            token += f"#{el.get('id')}"
        cls = el.get("class")
        if cls:
            token += "." + ".".join(cls.split()[:3])
        if el.get("role"):
            token += f"[role={el.get('role')}]"
        text = (el.text or "").strip()
        if text:
            snippet = text[:_SKELETON_TEXT_MAX] + ("…" if len(text) > _SKELETON_TEXT_MAX else "")
            token += f"  «{snippet}»"
        lines.append(token)
        if len(lines) >= max_nodes:
            break
    return "\n".join(lines)


def template_fingerprint(html: str, max_nodes: int = 200) -> str:
    """Stable hash of DOM shape (tags + id/class, text ignored) for rule caching."""
    root = _parse(html)
    if root is None:
        return "empty"
    parts: list[str] = []
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        cls = el.get("class") or ""
        parts.append(f"{el.tag}#{el.get('id') or ''}.{'.'.join(sorted(cls.split()))}")
        if len(parts) >= max_nodes:
            break
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_skeleton.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/extraction/skeleton.py tests/unit/test_extraction_skeleton.py
git commit -m "feat(extraction): DOM skeleton + template fingerprint"
```

---

### Task 3: Rule applier (CSS-subset matcher)

**Files:**
- Create: `legacy/python/resume_builder/extraction/rules.py`
- Test: `tests/unit/test_extraction_rules.py`

**Interfaces:**
- Consumes: `ExtractionRule` from `resume_builder.industry`.
- Produces: `apply_rules(html: str, rule: ExtractionRule) -> str`. (Engine added in Task 4, same file.)

Selector subset (documented contract for the LLM in Task 4): `tag`, `.class`, `#id`, `[role=value]`, `tag.class`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_extraction_rules.py
from resume_builder.extraction.rules import apply_rules
from resume_builder.industry import ExtractionRule

_HTML = """
<html><body>
  <header class="nav">Home About Contact</header>
  <main><article class="post">Built a C++ compiler with lexical analysis.</article></main>
  <footer id="foot">copyright 2026</footer>
</body></html>
"""


def test_drop_selectors_remove_chrome():
    rule = ExtractionRule(source_id="x", drop_selectors=["header.nav", "#foot"])
    text = apply_rules(_HTML, rule)
    assert "C++ compiler" in text
    assert "Home About" not in text
    assert "copyright" not in text


def test_keep_selectors_restrict_to_content():
    rule = ExtractionRule(source_id="x", keep_selectors=["article.post"])
    text = apply_rules(_HTML, rule)
    assert text.strip() == "Built a C++ compiler with lexical analysis."


def test_empty_rule_keeps_all_text():
    text = apply_rules(_HTML, ExtractionRule(source_id="x"))
    assert "C++ compiler" in text and "Home About" in text


def test_keep_regex_filters_lines():
    rule = ExtractionRule(source_id="x", keep_regex=["C\\+\\+"])
    text = apply_rules(_HTML, rule)
    assert "C++ compiler" in text
    assert "copyright" not in text


def test_garbage_html_returns_empty():
    assert apply_rules("", ExtractionRule(source_id="x")) == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_rules.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/extraction/rules.py
from __future__ import annotations

import re

import lxml.html

from ..industry import ExtractionRule

_SEL_RE = re.compile(
    r"^(?P<tag>[a-zA-Z0-9]+)?(?:#(?P<id>[\w-]+))?(?:\.(?P<cls>[\w-]+))?(?:\[role=(?P<role>[\w-]+)\])?$"
)


def _parse(html: str):
    try:
        return lxml.html.fromstring(html)
    except Exception:
        return None


def _matches(el, selector: str) -> bool:
    m = _SEL_RE.match(selector.strip())
    if not m or not isinstance(el.tag, str):
        return False
    g = m.groupdict()
    if not any(g.values()):
        return False
    if g["tag"] and el.tag.lower() != g["tag"].lower():
        return False
    if g["id"] and el.get("id") != g["id"]:
        return False
    if g["cls"] and g["cls"] not in (el.get("class") or "").split():
        return False
    if g["role"] and el.get("role") != g["role"]:
        return False
    return True


_BLOCK_TAGS = {
    "p", "div", "li", "ul", "ol", "section", "article", "header", "footer",
    "main", "nav", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "pre",
    "blockquote", "table", "tr", "td",
}


def _el_text(el) -> str:
    return " ".join(t.strip() for t in el.itertext() if t.strip())


def _block_lines(root) -> list[str]:
    """One de-duplicated line of visible text per block element, in document order."""
    lines: list[str] = []
    seen: set[str] = set()
    for el in root.iter():
        if not isinstance(el.tag, str) or el.tag not in _BLOCK_TAGS:
            continue
        txt = _el_text(el)
        if txt and txt not in seen:  # dedupe parent/child blocks that repeat the same text
            lines.append(txt)
            seen.add(txt)
    return lines


def apply_rules(html: str, rule: ExtractionRule) -> str:
    """Deterministically reduce HTML to text using an ExtractionRule. Never raises."""
    root = _parse(html)
    if root is None:
        return ""
    for el in list(root.iter()):
        if isinstance(el.tag, str) and any(_matches(el, s) for s in rule.drop_selectors):
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)
    if rule.keep_selectors:
        kept = [
            el for el in root.iter()
            if isinstance(el.tag, str) and any(_matches(el, s) for s in rule.keep_selectors)
        ]
        text = "\n".join(t for t in (_el_text(el) for el in kept) if t)
    else:
        text = "\n".join(_block_lines(root))
    if rule.keep_regex:
        pats = [re.compile(p) for p in rule.keep_regex]
        text = "\n".join(ln for ln in text.splitlines() if any(p.search(ln) for p in pats))
    return text.strip()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_rules.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/extraction/rules.py tests/unit/test_extraction_rules.py
git commit -m "feat(extraction): deterministic rule applier (CSS-subset matcher)"
```

---

### Task 4: `ExtractionRuleEngine` (AI rule-gen + fingerprint cache)

**Files:**
- Modify: `legacy/python/resume_builder/extraction/rules.py` (append the engine)
- Test: `tests/unit/test_extraction_rules.py` (append)

**Interfaces:**
- Consumes: `LLMProvider` (`resume_builder.llm.base`), `build_skeleton`/`template_fingerprint` (Task 2), `ExtractionRule`.
- Produces: `ExtractionRuleEngine(llm: LLMProvider, cache: dict | None = None)` with `.rules_for(source_id: str, html: str) -> ExtractionRule`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_extraction_rules.py  (append)
from resume_builder.extraction.rules import ExtractionRuleEngine

_PAGE = "<html><body><header class='nav'>Menu</header><main><p>Project X does Y.</p></main></body></html>"
_PAGE_SAME_SHAPE = _PAGE.replace("Project X does Y.", "Project Z does W.")
_PAGE_DIFF = "<html><body><section><h1>Title</h1></section></body></html>"


class _FakeLLM:
    def __init__(self):
        self.calls = 0

    def structured(self, prompt, schema, system=None, max_tokens=2048):
        self.calls += 1
        return schema(source_id="placeholder", drop_selectors=["header.nav"])


def test_engine_caches_by_fingerprint():
    llm = _FakeLLM()
    engine = ExtractionRuleEngine(llm)
    r1 = engine.rules_for("u1", _PAGE)
    r2 = engine.rules_for("u2", _PAGE_SAME_SHAPE)  # same shape → cache hit
    assert llm.calls == 1
    assert r1.drop_selectors == ["header.nav"]
    assert r2.drop_selectors == ["header.nav"]
    engine.rules_for("u3", _PAGE_DIFF)  # new shape → new call
    assert llm.calls == 2


def test_engine_sets_source_id_on_returned_rule():
    engine = ExtractionRuleEngine(_FakeLLM())
    rule = engine.rules_for("owner/repo", _PAGE)
    assert rule.source_id == "owner/repo"


def test_engine_falls_back_to_empty_rule_on_llm_error():
    class _BoomLLM:
        def structured(self, *a, **k):
            raise RuntimeError("boom")

    rule = ExtractionRuleEngine(_BoomLLM()).rules_for("x", _PAGE)
    assert rule.drop_selectors == [] and rule.keep_selectors == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_rules.py -k engine -v`
Expected: FAIL with `ImportError: cannot import name 'ExtractionRuleEngine'`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/extraction/rules.py  (append; add imports at top)
from ..llm.base import LLMProvider
from .skeleton import build_skeleton, template_fingerprint

_ENGINE_SYSTEM = (
    "You reduce a web page to its main content for downstream resume tagging. Given a DOM "
    "SKELETON (tags + #id/.class/[role], text stripped), return keep_selectors, drop_selectors, "
    "and keep_regex that retain the primary article/project/README content and DROP headers, "
    "navbars, footers, cookie/CTA banners, and repeated site chrome. Selectors use a simple "
    "subset only: tag, .class, #id, [role=value], or tag.class. Be concise."
)


class ExtractionRuleEngine:
    """AI rule generator with a per-template-fingerprint cache."""

    def __init__(self, llm: LLMProvider, cache: dict | None = None) -> None:
        self._llm = llm
        self._cache: dict = cache if cache is not None else {}

    def rules_for(self, source_id: str, html: str) -> ExtractionRule:
        fp = template_fingerprint(html)
        cached = self._cache.get(fp)
        if cached is not None:
            return cached
        skeleton = build_skeleton(html)
        prompt = (
            f"source_id: {source_id}\n\nDOM SKELETON:\n{skeleton}\n\n"
            "Return the extraction rule."
        )
        try:
            rule = self._llm.structured(
                prompt, schema=ExtractionRule, system=_ENGINE_SYSTEM, max_tokens=1024
            )
            rule.source_id = source_id
        except Exception:
            rule = ExtractionRule(source_id=source_id)
        self._cache[fp] = rule
        return rule
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_rules.py -v`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/extraction/rules.py tests/unit/test_extraction_rules.py
git commit -m "feat(extraction): ExtractionRuleEngine with fingerprint cache"
```

---

### Task 5: `SourceFetcher` (static-first + headless fallback)

**Files:**
- Create: `legacy/python/resume_builder/extraction/fetch.py`
- Test: `tests/unit/test_extraction_fetch.py`

**Interfaces:**
- Consumes: nothing required at construction; `headless_fetch` and `http_get` are injectable callables (`Callable[[str], str]`) for testability.
- Produces: `SourceFetcher(headless_fetch=None, http_get=None)` with `.fetch(url: str) -> tuple[str, bool]` returning `(html, degraded)`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_extraction_fetch.py
from resume_builder.extraction.fetch import SourceFetcher

_RICH = "<html><body><article>" + ("Real content. " * 40) + "</article></body></html>"
_THIN = "<html><body><div id='root'></div></body></html>"


def test_static_rich_page_no_fallback():
    f = SourceFetcher(http_get=lambda u: _RICH, headless_fetch=lambda u: "SHOULD_NOT_RUN")
    html, degraded = f.fetch("http://x")
    assert "Real content" in html and degraded is False


def test_thin_page_escalates_to_headless():
    f = SourceFetcher(http_get=lambda u: _THIN, headless_fetch=lambda u: _RICH)
    html, degraded = f.fetch("http://x")
    assert "Real content" in html and degraded is True


def test_thin_page_no_headless_returns_degraded():
    f = SourceFetcher(http_get=lambda u: _THIN, headless_fetch=None)
    html, degraded = f.fetch("http://x")
    assert html == _THIN and degraded is True


def test_headless_failure_keeps_static():
    def boom(_u):
        raise RuntimeError("no browser")

    f = SourceFetcher(http_get=lambda u: _THIN, headless_fetch=boom)
    html, degraded = f.fetch("http://x")
    assert html == _THIN and degraded is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_fetch.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/extraction/fetch.py
from __future__ import annotations

import logging
import re
from typing import Callable

import requests

log = logging.getLogger(__name__)

_UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}
_THIN_TEXT_MIN = 200  # visible-text chars below which we suspect a JS-rendered shell


def _visible_text_len(html: str) -> int:
    return len(re.sub(r"<[^>]+>", " ", html or "").strip())


def _default_get(url: str) -> str:
    try:
        resp = requests.get(url, headers=_UA, timeout=20)
        resp.raise_for_status()
        return resp.text
    except Exception as exc:  # noqa: BLE001 — network failure degrades, never raises
        log.warning("static fetch failed for %s: %s", url, exc)
        return ""


class SourceFetcher:
    """Static-first fetch with a headless fallback for thin/JS-rendered pages."""

    def __init__(
        self,
        headless_fetch: Callable[[str], str] | None = None,
        http_get: Callable[[str], str] | None = None,
    ) -> None:
        self._headless = headless_fetch
        self._get = http_get or _default_get

    def fetch(self, url: str) -> tuple[str, bool]:
        html = self._get(url)
        if _visible_text_len(html) >= _THIN_TEXT_MIN:
            return html, False
        if self._headless is not None:
            try:
                rendered = self._headless(url)
            except Exception as exc:  # noqa: BLE001
                log.warning("headless fetch failed for %s: %s", url, exc)
                rendered = ""
            if _visible_text_len(rendered) > _visible_text_len(html):
                return rendered, True
        return html, True
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_fetch.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/extraction/fetch.py tests/unit/test_extraction_fetch.py
git commit -m "feat(extraction): SourceFetcher with static-first + headless fallback"
```

---

### Task 6: GitHub markdown traversal

**Files:**
- Create: `legacy/python/resume_builder/extraction/github_traversal.py`
- Test: `tests/unit/test_extraction_github.py`

**Interfaces:**
- Consumes: a `gh_json: Callable[[list[str]], object]` seam (in prod, `GitHubSource()._gh_json`); `CleanedSource` (Task 1).
- Produces: `collect_repo_markdown(full_name: str, gh_json, ref: str = "HEAD") -> list[CleanedSource]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_extraction_github.py
import base64

from resume_builder.extraction.github_traversal import collect_repo_markdown


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


def test_markdown_noise_is_stripped():
    sources = collect_repo_markdown("owner/repo", _fake_gh_json([]))
    root = next(s for s in sources if s.title == "README.md")
    assert "Real text." in root.text
    assert "<!--" not in root.text and "badge" not in root.text


def test_tree_failure_returns_empty():
    assert collect_repo_markdown("owner/repo", lambda args: None) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_github.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/extraction/github_traversal.py
from __future__ import annotations

import base64
import logging
import re
from typing import Callable

from .models import CleanedSource

log = logging.getLogger(__name__)

_MD_KEEP = re.compile(r"(^|/)README\.[^/]+$|^docs/.*\.md$", re.IGNORECASE)


def _strip_md_noise(text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)            # HTML comments
    text = re.sub(r"\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)", "", text)      # badge links
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)                   # images
    text = re.sub(r"<[^>]+>", "", text)                               # raw html tags
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def collect_repo_markdown(
    full_name: str,
    gh_json: Callable[[list[str]], object],
    ref: str = "HEAD",
) -> list[CleanedSource]:
    """Collect every README.* + docs/*.md in a repo as light-normalized CleanedSources."""
    try:
        tree = gh_json(["api", f"repos/{full_name}/git/trees/{ref}?recursive=1"]) or {}
    except Exception as exc:  # noqa: BLE001
        log.warning("git-tree fetch failed for %s: %s", full_name, exc)
        return []
    out: list[CleanedSource] = []
    for node in (tree.get("tree", []) if isinstance(tree, dict) else []):
        path = node.get("path", "")
        if node.get("type") != "blob" or not _MD_KEEP.search(path):
            continue
        try:
            blob = gh_json(["api", f"repos/{full_name}/contents/{path}"]) or {}
            raw = base64.b64decode(blob.get("content", "")).decode("utf-8", "replace")
        except Exception as exc:  # noqa: BLE001
            log.warning("blob fetch failed for %s/%s: %s", full_name, path, exc)
            continue
        if not raw.strip():
            continue
        out.append(
            CleanedSource(
                source_id=f"{full_name}:{path}",
                kind="github_readme",
                title=path,
                text=_strip_md_noise(raw),
                section_hints=[path],
            )
        )
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_github.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/extraction/github_traversal.py tests/unit/test_extraction_github.py
git commit -m "feat(extraction): GitHub README + docs markdown traversal"
```

---

### Task 7: `extract_website` orchestrator + token cap + public API

**Files:**
- Create: `legacy/python/resume_builder/extraction/web.py`
- Modify: `legacy/python/resume_builder/extraction/__init__.py` (export the public surface)
- Test: `tests/unit/test_extraction_web.py`

**Interfaces:**
- Consumes: `SourceFetcher` (Task 5), `ExtractionRuleEngine` (Task 4), `apply_rules` (Task 3), `CleanedSource` + `DEFAULT_CAP_CHARS` (Task 1).
- Produces: `extract_website(url: str, fetcher: SourceFetcher, engine: ExtractionRuleEngine, cap_chars: int = DEFAULT_CAP_CHARS) -> CleanedSource`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_extraction_web.py
from resume_builder.extraction.fetch import SourceFetcher
from resume_builder.extraction.rules import ExtractionRuleEngine
from resume_builder.extraction.web import extract_website
from resume_builder.industry import ExtractionRule

_PAGE = (
    "<html><body><header class='nav'>Menu Home</header>"
    "<main><article class='post'>Built a PyTorch model and trained it.</article></main>"
    "<footer>copyright</footer></body></html>"
)


class _RuleLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        return schema(source_id="x", keep_selectors=["article.post"])


def _fetcher(html):
    return SourceFetcher(http_get=lambda u: html, headless_fetch=None)


def test_extract_website_returns_clean_content():
    cs = extract_website("http://x", _fetcher(_PAGE), ExtractionRuleEngine(_RuleLLM()))
    assert cs.kind == "website" and cs.source_id == "http://x"
    assert cs.text.strip() == "Built a PyTorch model and trained it."
    assert "Menu" not in cs.text and "copyright" not in cs.text


def test_token_cap_truncates_and_flags():
    big = "<html><body><article class='post'>" + ("word " * 5000) + "</article></body></html>"
    cs = extract_website("http://x", _fetcher(big), ExtractionRuleEngine(_RuleLLM()), cap_chars=100)
    assert cs.truncated is True and len(cs.text) <= 100


def test_empty_extraction_marks_degraded():
    class _Empty:
        def structured(self, *a, **k):
            return ExtractionRule(source_id="x", keep_selectors=["nope.none"])

    cs = extract_website("http://x", _fetcher(_PAGE), ExtractionRuleEngine(_Empty()))
    assert cs.degraded is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_web.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/extraction/web.py
from __future__ import annotations

from .fetch import SourceFetcher
from .models import DEFAULT_CAP_CHARS, CleanedSource
from .rules import ExtractionRuleEngine, apply_rules


def extract_website(
    url: str,
    fetcher: SourceFetcher,
    engine: ExtractionRuleEngine,
    cap_chars: int = DEFAULT_CAP_CHARS,
) -> CleanedSource:
    """Fetch a page, learn/apply its extraction rule, return token-capped CleanedSource."""
    html, degraded = fetcher.fetch(url)
    rule = engine.rules_for(url, html)
    text = apply_rules(html, rule)
    truncated = len(text) > cap_chars
    return CleanedSource(
        source_id=url,
        kind="website",
        text=text[:cap_chars],
        truncated=truncated,
        degraded=degraded or not text.strip(),
    )
```

```python
# legacy/python/resume_builder/extraction/__init__.py  (replace file)
"""P2 — website-agnostic extraction package."""
from __future__ import annotations

from .fetch import SourceFetcher
from .github_traversal import collect_repo_markdown
from .models import CHARS_PER_TOKEN, DEFAULT_CAP_CHARS, DEFAULT_TOKEN_CAP, CleanedSource
from .rules import ExtractionRuleEngine, apply_rules
from .web import extract_website

__all__ = [
    "CleanedSource",
    "CHARS_PER_TOKEN",
    "DEFAULT_TOKEN_CAP",
    "DEFAULT_CAP_CHARS",
    "SourceFetcher",
    "ExtractionRuleEngine",
    "apply_rules",
    "collect_repo_markdown",
    "extract_website",
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_web.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Run the full extraction suite + commit**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_extraction_*.py -v`
Expected: PASS (all extraction tests green).

```bash
git add legacy/python/resume_builder/extraction/web.py legacy/python/resume_builder/extraction/__init__.py tests/unit/test_extraction_web.py
git commit -m "feat(extraction): website orchestrator + token cap + public API"
```

---

## Notes for the implementer

- **Headless wiring (deferred to P1/integration):** `SourceFetcher`'s `headless_fetch` is an injected callable. A generic Playwright chromium fetch (launch → `goto` → `content()`) can be supplied later; do NOT reuse `sources/social/headless_browser.fetch_rendered_html` here — that requires a vendor-bound authenticated session and is for social scraping, not arbitrary sites.
- **Deep code-aware mode (designed, not built here):** the spec's broad-source-sweep mode lives in P2's scope but is intentionally out of this first plan. Add it as `collect_repo_code(full_name, gh_json, token_budget)` in `github_traversal.py` in a follow-up, mirroring Task 6's seam + bounding discipline.
- **"Test mo if working":** after Task 7, a quick manual smoke (one real GitHub repo via `GitHubSource()._gh_json`, one real URL) validates the end-to-end path before P3 consumes it. This is the user-requested working test + reverse-prompt checkpoint.
