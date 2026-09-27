# P3 — Interpretation & Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P3 interpretation engine — a retrieval middleman + parallel per-source tagging (with reconciliation/KPI) + compile + global normalization — that turns retrieved sources into a normalized `IndustryClassification`, plus a user-profile sink (skills + industry tags).

**Architecture:** A new `resume_builder.interpretation` package. A `RetrievalMiddleman` normalizes GitHub/post/document inputs into one `RetrievedSource` envelope. `ParallelTagRunner` fans each source out to a `ProjectTagger` (LLM, mockable) concurrently, tracks sent-vs-returned with bounded retry (KPI), `TagCompiler` concatenates, `GlobalNormalizer` merges industries+skills via one AI pass (deterministic fallback), and `ProfileSink` persists the skills + industry tags as the user profile. Everything LLM-touching is behind the `LLMProvider` ABC.

**Tech Stack:** Python 3.11+, pydantic v2, `concurrent.futures.ThreadPoolExecutor` (stdlib), pytest + pytest-mock. Reuses `resume_builder.industry` (`TaggedProject`, `IndustryClassification`, `_normalize_classification`, `_dedupe`, `_clean_tag`), `resume_builder.llm.base.LLMProvider`, `resume_builder.extraction.CleanedSource`, `resume_builder.models.RawDocument`.

## Global Constraints

- Python `>=3.11`; pydantic `>=2.7`; line-length 100; `from __future__ import annotations` at the top of every module (production AND test).
- **No new dependencies.** stdlib + pydantic only. Concurrency via `concurrent.futures.ThreadPoolExecutor`.
- The only LLM-touching units are `ProjectTagger` and `GlobalNormalizer`, both behind `LLMProvider` (mockable). No live network in tests.
- Reuse `TaggedProject` / `IndustryClassification` (`resume_builder.industry`) — do NOT redefine them.
- Tags are **industry names**, never skills; skills go in `skill_subtags`. Multi-industry allowed.
- Bullets: `quantitative_impact` is separate from `qualitative_impact`; never invent numbers.
- Every unit degrades (returns empty/partial with a flag/report), never raises, on a single source's failure. A source that never returns is a **tracked miss**, not dropped silently.
- Concurrency cap: default `max_workers=6`; bounded retry: default `max_retries=1`.

---

## File Structure

| File | Responsibility |
|---|---|
| `legacy/python/resume_builder/interpretation/__init__.py` | public API + `interpret()` orchestrator |
| `legacy/python/resume_builder/interpretation/models.py` | `RetrievedSource`, `TagRunReport`, `UserProfile` |
| `legacy/python/resume_builder/interpretation/middleman.py` | `RetrievalMiddleman.gather(...)` → `list[RetrievedSource]` |
| `legacy/python/resume_builder/interpretation/tagger.py` | `ProjectTagger.tag(source)` → `TaggedProject` (LLM) |
| `legacy/python/resume_builder/interpretation/runner.py` | `ParallelTagRunner.run(sources)` → `(list[TaggedProject], TagRunReport)` |
| `legacy/python/resume_builder/interpretation/compiler.py` | `compile_tags(results)` → concatenated `list[TaggedProject]` |
| `legacy/python/resume_builder/interpretation/normalizer.py` | `GlobalNormalizer.normalize(projects)` → `IndustryClassification` |
| `legacy/python/resume_builder/interpretation/profile.py` | `build_user_profile(...)` + `ProfileSink.save(...)` |
| `tests/unit/interpretation/__init__.py` | (empty) test package marker |
| `tests/unit/interpretation/test_*.py` | one per module + orchestrator |

---

### Task 1: Core models — `RetrievedSource`, `TagRunReport`, `UserProfile`

**Files:**
- Create: `legacy/python/resume_builder/interpretation/__init__.py`
- Create: `legacy/python/resume_builder/interpretation/models.py`
- Test: `tests/unit/interpretation/__init__.py`, `tests/unit/interpretation/test_models.py`

**Interfaces:**
- Produces: `RetrievedSource(source_id: str, kind: str, title: str = "", text: str = "", origin: str = "")`; `TagRunReport(sent: int = 0, returned: int = 0, failed: int = 0, failures: list[str] = [], elapsed_s: float = 0.0)` with a `success_rate` property; `UserProfile(skills: list[str] = [], industries: list[str] = [])`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/interpretation/test_models.py
from resume_builder.interpretation.models import RetrievedSource, TagRunReport, UserProfile


def test_retrieved_source_defaults():
    s = RetrievedSource(source_id="owner/repo", kind="project")
    assert s.text == "" and s.origin == ""


def test_tag_run_report_success_rate():
    r = TagRunReport(sent=4, returned=3, failed=1)
    assert abs(r.success_rate - 0.75) < 1e-9
    assert TagRunReport().success_rate == 0.0  # no sends → 0, no ZeroDivision


def test_user_profile_defaults_independent():
    a, b = UserProfile(), UserProfile()
    a.skills.append("Python")
    assert b.skills == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: resume_builder.interpretation`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/interpretation/__init__.py
"""P3 — interpretation & tagging package."""
from __future__ import annotations

from .models import RetrievedSource, TagRunReport, UserProfile

__all__ = ["RetrievedSource", "TagRunReport", "UserProfile"]
```

```python
# legacy/python/resume_builder/interpretation/models.py
from __future__ import annotations

from pydantic import BaseModel, Field


class RetrievedSource(BaseModel):
    """One source entering tagging, normalized by the retrieval middleman."""

    source_id: str
    kind: str  # "project" | "post" | "document"
    title: str = ""
    text: str = ""
    origin: str = ""  # "github" | "facebook" | "website" | "upload" ...


class TagRunReport(BaseModel):
    """KPI/reconciliation for one parallel tagging run."""

    sent: int = 0
    returned: int = 0
    failed: int = 0
    failures: list[str] = Field(default_factory=list)  # source_ids that never returned
    elapsed_s: float = 0.0

    @property
    def success_rate(self) -> float:
        return self.returned / self.sent if self.sent else 0.0


class UserProfile(BaseModel):
    """The 'profile catcher' output: only skills + industry tags (no source links)."""

    skills: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/test_models.py -v`
Expected: PASS (3 passed). Also create an empty `tests/unit/interpretation/__init__.py`.

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/interpretation/__init__.py legacy/python/resume_builder/interpretation/models.py tests/unit/interpretation/__init__.py tests/unit/interpretation/test_models.py
git commit -m "feat(interpretation): core models (RetrievedSource, TagRunReport, UserProfile)"
```

---

### Task 2: `RetrievalMiddleman` — gather all sources into one envelope

**Files:**
- Create: `legacy/python/resume_builder/interpretation/middleman.py`
- Test: `tests/unit/interpretation/test_middleman.py`

**Interfaces:**
- Consumes: `RetrievedSource` (Task 1); `CleanedSource` (`resume_builder.extraction`); `RawDocument` (`resume_builder.models`).
- Produces: `RetrievalMiddleman().gather(projects: list[CleanedSource] | None = None, documents: list[RawDocument] | None = None, posts: list[RetrievedSource] | None = None) -> list[RetrievedSource]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/interpretation/test_middleman.py
from resume_builder.extraction.models import CleanedSource
from resume_builder.interpretation.middleman import RetrievalMiddleman
from resume_builder.interpretation.models import RetrievedSource
from resume_builder.models import DocumentType, RawDocument


def test_gather_normalizes_all_kinds():
    projects = [CleanedSource(source_id="owner/repo:README.md", kind="github_readme",
                              title="README.md", text="Builds a PyTorch model.")]
    documents = [RawDocument(path="/cv.pdf", filename="cv.pdf", doc_type=DocumentType.PDF,
                             text="John — AI engineer.")]
    posts = [RetrievedSource(source_id="fb:1", kind="post", text="Won a hackathon.", origin="facebook")]

    out = RetrievalMiddleman().gather(projects=projects, documents=documents, posts=posts)
    kinds = {s.kind for s in out}
    assert kinds == {"project", "document", "post"}
    proj = next(s for s in out if s.kind == "project")
    assert proj.origin == "github" and "PyTorch" in proj.text
    doc = next(s for s in out if s.kind == "document")
    assert doc.origin == "upload" and doc.source_id == "cv.pdf"


def test_gather_skips_empty_text():
    projects = [CleanedSource(source_id="x", kind="github_readme", text="   ")]
    assert RetrievalMiddleman().gather(projects=projects) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/test_middleman.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/interpretation/middleman.py
from __future__ import annotations

from ..extraction.models import CleanedSource
from ..models import RawDocument
from .models import RetrievedSource


class RetrievalMiddleman:
    """The single entry that gathers every source type into RetrievedSource envelopes."""

    def gather(
        self,
        projects: list[CleanedSource] | None = None,
        documents: list[RawDocument] | None = None,
        posts: list[RetrievedSource] | None = None,
    ) -> list[RetrievedSource]:
        out: list[RetrievedSource] = []
        for cs in projects or []:
            if cs.text.strip():
                out.append(RetrievedSource(
                    source_id=cs.source_id, kind="project", title=cs.title,
                    text=cs.text, origin="github",
                ))
        for doc in documents or []:
            if doc.text.strip():
                out.append(RetrievedSource(
                    source_id=doc.filename, kind="document", title=doc.filename,
                    text=doc.text, origin="upload",
                ))
        for post in posts or []:
            if post.text.strip():
                out.append(post if post.kind == "post" else post.model_copy(update={"kind": "post"}))
        return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/test_middleman.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/interpretation/middleman.py tests/unit/interpretation/test_middleman.py
git commit -m "feat(interpretation): RetrievalMiddleman gathers project/post/document sources"
```

---

### Task 3: `ProjectTagger` — tag ONE source via the LLM

**Files:**
- Create: `legacy/python/resume_builder/interpretation/tagger.py`
- Test: `tests/unit/interpretation/test_tagger.py`

**Interfaces:**
- Consumes: `RetrievedSource` (Task 1); `LLMProvider` (`resume_builder.llm.base`); `TaggedProject` (`resume_builder.industry`).
- Produces: `ProjectTagger(llm: LLMProvider)` with `.tag(source: RetrievedSource) -> TaggedProject` (sets `repo_full_name = source.source_id`).

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/interpretation/test_tagger.py
from resume_builder.industry import TaggedProject
from resume_builder.interpretation.models import RetrievedSource
from resume_builder.interpretation.tagger import ProjectTagger


class _FakeLLM:
    def __init__(self, payload):
        self.payload = payload
        self.calls = 0

    def structured(self, prompt, schema, system=None, max_tokens=2048):
        self.calls += 1
        return schema(**self.payload)


def test_tag_returns_tagged_project_with_source_id():
    llm = _FakeLLM({"repo_full_name": "ignored", "industries": ["artificial intelligence"],
                    "skill_subtags": ["Python"]})
    tp = ProjectTagger(llm).tag(RetrievedSource(source_id="owner/repo", kind="project",
                                                text="PyTorch model training."))
    assert isinstance(tp, TaggedProject)
    assert tp.repo_full_name == "owner/repo"  # forced to the source id
    assert tp.industries == ["artificial intelligence"]


def test_tag_falls_back_to_empty_on_llm_error():
    class _Boom:
        def structured(self, *a, **k):
            raise RuntimeError("boom")

    tp = ProjectTagger(_Boom()).tag(RetrievedSource(source_id="s1", kind="post", text="x"))
    assert tp.repo_full_name == "s1" and tp.industries == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/test_tagger.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/interpretation/tagger.py
from __future__ import annotations

from ..industry import TaggedProject
from ..llm.base import LLMProvider
from ..principles import HARVARD_PRINCIPLES
from .models import RetrievedSource

_TAGGER_SYSTEM = (
    "You tag ONE candidate source by INDUSTRY for an industry-first resume system. "
    "industries = industry/domain NAMES (e.g. 'artificial intelligence', 'cybersecurity'), never "
    "skills. A source may have MULTIPLE industries when its real components justify them (a web app "
    "with security features is web AND cybersecurity). Put skills only in skill_subtags. Separate "
    "quantitative_impact (numbers from the text) from qualitative_impact; never invent numbers. "
    "Be concise.\n\n"
) + HARVARD_PRINCIPLES


class ProjectTagger:
    """Tags a single RetrievedSource into a TaggedProject. Never raises."""

    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    def tag(self, source: RetrievedSource) -> TaggedProject:
        prompt = (
            f"Source id: {source.source_id}\nKind: {source.kind}\nTitle: {source.title}\n\n"
            f"Content:\n{source.text}\n\n"
            "Return the tagged record (industries, skill_subtags, summary, "
            "quantitative_impact, qualitative_impact)."
        )
        try:
            tagged = self._llm.structured(
                prompt, schema=TaggedProject, system=_TAGGER_SYSTEM, max_tokens=1024
            )
        except Exception:  # noqa: BLE001 — any LLM/parse failure degrades to an empty tag
            tagged = TaggedProject(repo_full_name=source.source_id)
        tagged.repo_full_name = source.source_id
        return tagged
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/test_tagger.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/interpretation/tagger.py tests/unit/interpretation/test_tagger.py
git commit -m "feat(interpretation): ProjectTagger tags one source via the LLM"
```

---

### Task 4: `ParallelTagRunner` — fan-out + reconciliation/KPI + bounded retry

**Files:**
- Create: `legacy/python/resume_builder/interpretation/runner.py`
- Test: `tests/unit/interpretation/test_runner.py`

**Interfaces:**
- Consumes: `RetrievedSource`, `TagRunReport` (Task 1); `ProjectTagger` (Task 3); `TaggedProject`.
- Produces: `ParallelTagRunner(tagger, max_workers: int = 6, max_retries: int = 1)` with `.run(sources: list[RetrievedSource]) -> tuple[list[TaggedProject], TagRunReport]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/interpretation/test_runner.py
import threading

from resume_builder.industry import TaggedProject
from resume_builder.interpretation.models import RetrievedSource
from resume_builder.interpretation.runner import ParallelTagRunner


class _CountingTagger:
    """Tagger stub: fails the first attempt for source 'flaky', succeeds on retry."""

    def __init__(self):
        self.seen = {}
        self.lock = threading.Lock()

    def tag(self, source):
        with self.lock:
            self.seen[source.source_id] = self.seen.get(source.source_id, 0) + 1
            attempt = self.seen[source.source_id]
        if source.source_id == "flaky" and attempt == 1:
            raise RuntimeError("transient")
        return TaggedProject(repo_full_name=source.source_id, industries=["ai"])


def _src(i):
    return RetrievedSource(source_id=i, kind="project", text="x")


def test_run_tags_all_sources_and_reports():
    runner = ParallelTagRunner(_CountingTagger(), max_workers=4, max_retries=1)
    results, report = runner.run([_src("a"), _src("b"), _src("flaky")])
    ids = {r.repo_full_name for r in results}
    assert ids == {"a", "b", "flaky"}            # flaky recovered on retry
    assert report.sent == 3 and report.returned == 3 and report.failed == 0


def test_run_reports_permanent_failure_without_dropping_silently():
    class _AlwaysFail:
        def tag(self, source):
            raise RuntimeError("dead")

    results, report = ParallelTagRunner(_AlwaysFail(), max_retries=1).run([_src("a"), _src("b")])
    assert results == []
    assert report.sent == 2 and report.returned == 0 and report.failed == 2
    assert set(report.failures) == {"a", "b"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/test_runner.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/interpretation/runner.py
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from ..industry import TaggedProject
from .models import RetrievedSource, TagRunReport

log = logging.getLogger(__name__)


class ParallelTagRunner:
    """Fan sources out to the tagger concurrently; reconcile sent-vs-returned with bounded retry."""

    def __init__(self, tagger, max_workers: int = 6, max_retries: int = 1) -> None:
        self._tagger = tagger
        self._max_workers = max(1, max_workers)
        self._max_retries = max(0, max_retries)

    def _tag_with_retry(self, source: RetrievedSource) -> TaggedProject | None:
        for attempt in range(self._max_retries + 1):
            try:
                return self._tagger.tag(source)
            except Exception as exc:  # noqa: BLE001 — retry, then give up (reported, not raised)
                log.warning("tag failed for %s (attempt %d): %s", source.source_id, attempt + 1, exc)
        return None

    def run(self, sources: list[RetrievedSource]) -> tuple[list[TaggedProject], TagRunReport]:
        start = time.monotonic()
        results: list[TaggedProject] = []
        failures: list[str] = []
        if not sources:
            return results, TagRunReport()
        with ThreadPoolExecutor(max_workers=self._max_workers) as pool:
            futures = {pool.submit(self._tag_with_retry, s): s for s in sources}
            for fut in as_completed(futures):
                source = futures[fut]
                tagged = fut.result()
                if tagged is None:
                    failures.append(source.source_id)
                else:
                    results.append(tagged)
        report = TagRunReport(
            sent=len(sources),
            returned=len(results),
            failed=len(failures),
            failures=failures,
            elapsed_s=time.monotonic() - start,
        )
        return results, report
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/test_runner.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/interpretation/runner.py tests/unit/interpretation/test_runner.py
git commit -m "feat(interpretation): ParallelTagRunner with reconciliation/KPI + bounded retry"
```

---

### Task 5: `TagCompiler` — concatenate (no merge)

**Files:**
- Create: `legacy/python/resume_builder/interpretation/compiler.py`
- Test: `tests/unit/interpretation/test_compiler.py`

**Interfaces:**
- Consumes: `TaggedProject`.
- Produces: `compile_tags(*result_lists: list[TaggedProject]) -> list[TaggedProject]` — flat concatenation preserving order, dropping `None`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/interpretation/test_compiler.py
from resume_builder.industry import TaggedProject
from resume_builder.interpretation.compiler import compile_tags


def test_compile_concatenates_preserving_each_result():
    a = [TaggedProject(repo_full_name="a", industries=["ai"])]
    b = [TaggedProject(repo_full_name="b", industries=["web"]),
         TaggedProject(repo_full_name="c", industries=["ai", "web"])]
    out = compile_tags(a, b)
    assert [t.repo_full_name for t in out] == ["a", "b", "c"]  # order preserved, nothing merged


def test_compile_drops_none_entries():
    out = compile_tags([TaggedProject(repo_full_name="a"), None])  # type: ignore[list-item]
    assert [t.repo_full_name for t in out] == ["a"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/test_compiler.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/interpretation/compiler.py
from __future__ import annotations

from ..industry import TaggedProject


def compile_tags(*result_lists: list[TaggedProject]) -> list[TaggedProject]:
    """Concatenate per-source tagging results into one list. No merging/dedup here."""
    out: list[TaggedProject] = []
    for lst in result_lists:
        for item in lst or []:
            if item is not None:
                out.append(item)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/test_compiler.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/interpretation/compiler.py tests/unit/interpretation/test_compiler.py
git commit -m "feat(interpretation): TagCompiler concatenates tagging results"
```

---

### Task 6: `GlobalNormalizer` — merge industries + skills (AI + deterministic fallback)

**Files:**
- Create: `legacy/python/resume_builder/interpretation/normalizer.py`
- Test: `tests/unit/interpretation/test_normalizer.py`

**Interfaces:**
- Consumes: `TaggedProject`, `IndustryClassification`, `_normalize_classification`, `_dedupe` (`resume_builder.industry`); `LLMProvider`.
- Produces: `GlobalNormalizer(llm: LLMProvider)` with `.normalize(projects: list[TaggedProject]) -> IndustryClassification`. Inner pydantic model `_AliasMap(industry_map: dict[str, str] = {}, skill_map: dict[str, str] = {})`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/interpretation/test_normalizer.py
from resume_builder.industry import TaggedProject
from resume_builder.interpretation.normalizer import GlobalNormalizer


class _MapLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        return schema(industry_map={"ai": "artificial intelligence"},
                      skill_map={"js": "JavaScript"})


def _projects():
    return [
        TaggedProject(repo_full_name="a", industries=["ai"], skill_subtags=["js"]),
        TaggedProject(repo_full_name="b", industries=["artificial intelligence"], skill_subtags=["JavaScript"]),
    ]


def test_normalize_merges_industries_and_skills():
    cls = GlobalNormalizer(_MapLLM()).normalize(_projects())
    assert cls.normalized_industries == ["artificial intelligence"]  # ai + artificial intelligence → one
    # every project rewritten to canonical labels
    assert all("ai" not in p.industries for p in cls.projects)
    assert all("js" not in p.skill_subtags for p in cls.projects)


def test_normalize_falls_back_deterministically_on_llm_error():
    class _Boom:
        def structured(self, *a, **k):
            raise RuntimeError("boom")

    cls = GlobalNormalizer(_Boom()).normalize([
        TaggedProject(repo_full_name="a", industries=["AI", "ai"], skill_subtags=["Python", "python"]),
    ])
    # deterministic lowercase/dedup fallback still de-duplicates
    assert cls.normalized_industries == ["ai"]
    assert cls.projects[0].skill_subtags == ["Python"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/test_normalizer.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/interpretation/normalizer.py
from __future__ import annotations

from pydantic import BaseModel, Field

from ..industry import IndustryClassification, TaggedProject, _dedupe, _normalize_classification
from ..llm.base import LLMProvider

_NORMALIZER_SYSTEM = (
    "You merge overlapping INDUSTRY names and SKILL names into single canonical labels for an "
    "industry-first resume system. Return two maps: industry_map and skill_map, each mapping a "
    "variant (lowercased) to its canonical label. Merge synonyms ('ai'→'artificial intelligence', "
    "'js'→'JavaScript', 'next.js'→'Next.js'). Avoid overlapping/duplicate canonical labels. Only "
    "include entries that actually need merging; be concise."
)


class _AliasMap(BaseModel):
    industry_map: dict[str, str] = Field(default_factory=dict)
    skill_map: dict[str, str] = Field(default_factory=dict)


def _apply(value: str, amap: dict[str, str]) -> str:
    return amap.get(value.strip().lower(), value.strip())


class GlobalNormalizer:
    """One AI pass merges industries + skills across all projects; deterministic fallback."""

    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    def _alias_map(self, projects: list[TaggedProject]) -> _AliasMap:
        industries = _dedupe(i for p in projects for i in p.industries)
        skills = _dedupe(s for p in projects for s in p.skill_subtags)
        prompt = (
            f"Industries seen: {industries}\nSkills seen: {skills}\n\n"
            "Return industry_map and skill_map (variant_lowercased -> canonical)."
        )
        try:
            return self._llm.structured(
                prompt, schema=_AliasMap, system=_NORMALIZER_SYSTEM, max_tokens=1024
            )
        except Exception:  # noqa: BLE001 — fall back to a deterministic lowercase/dedup merge
            return _AliasMap()

    def normalize(self, projects: list[TaggedProject]) -> IndustryClassification:
        amap = self._alias_map(projects)
        rewritten: list[TaggedProject] = []
        for p in projects:
            rewritten.append(p.model_copy(update={
                "industries": _dedupe(_apply(i, amap.industry_map) for i in p.industries),
                "skill_subtags": _dedupe(_apply(s, amap.skill_map) for s in p.skill_subtags),
            }))
        result = IndustryClassification(
            normalized_industries=_dedupe(i for p in rewritten for i in p.industries),
            projects=rewritten,
        )
        # reuse the existing canonicaliser (lowercases industry tags, dedups) for a clean fallback
        return _normalize_classification(result)
```

Note: `_normalize_classification` lowercases industry tags via `_clean_tag`; the AI-canonical labels are already lower-ish, and the deterministic fallback (`_AliasMap()` empty) still dedups variant casings — both tests rely on that behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/test_normalizer.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/interpretation/normalizer.py tests/unit/interpretation/test_normalizer.py
git commit -m "feat(interpretation): GlobalNormalizer merges industries + skills (AI + fallback)"
```

---

### Task 7: `ProfileSink` + `interpret()` orchestrator (the user-profile catcher)

**Files:**
- Create: `legacy/python/resume_builder/interpretation/profile.py`
- Modify: `legacy/python/resume_builder/interpretation/__init__.py` (export the orchestrator + new names)
- Test: `tests/unit/interpretation/test_profile.py`, `tests/unit/interpretation/test_orchestrator.py`

**Interfaces:**
- Consumes: everything above; `IndustryClassification`; `LLMProvider`; `CleanedSource`; `RawDocument`.
- Produces:
  - `build_user_profile(classification: IndustryClassification) -> UserProfile` — skills + industries only (no links).
  - `ProfileSink(out_dir: Path)` with `.save(profile: UserProfile) -> Path` (writes `user_profile.json`).
  - `interpret(llm: LLMProvider, projects=None, documents=None, posts=None, *, max_workers=6, max_retries=1) -> tuple[IndustryClassification, TagRunReport, UserProfile]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/interpretation/test_profile.py
from resume_builder.industry import IndustryClassification, TaggedProject
from resume_builder.interpretation.profile import ProfileSink, build_user_profile


def test_build_user_profile_collects_skills_and_industries_only():
    cls = IndustryClassification(
        normalized_industries=["artificial intelligence", "web development"],
        projects=[TaggedProject(repo_full_name="a", industries=["artificial intelligence"],
                                skill_subtags=["Python", "PyTorch"])],
    )
    prof = build_user_profile(cls)
    assert set(prof.industries) == {"artificial intelligence", "web development"}
    assert set(prof.skills) == {"Python", "PyTorch"}


def test_profile_sink_writes_json(tmp_path):
    from resume_builder.interpretation.models import UserProfile
    path = ProfileSink(tmp_path).save(UserProfile(skills=["Python"], industries=["ai"]))
    assert path.exists() and "Python" in path.read_text(encoding="utf-8")
```

```python
# tests/unit/interpretation/test_orchestrator.py
from resume_builder.extraction.models import CleanedSource
from resume_builder.interpretation import interpret


class _FakeLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        name = schema.__name__
        if name == "TaggedProject":
            return schema(repo_full_name="x", industries=["ai"], skill_subtags=["Python"])
        if name == "_AliasMap":
            return schema(industry_map={"ai": "artificial intelligence"}, skill_map={})
        return schema()


def test_interpret_end_to_end():
    projects = [CleanedSource(source_id="owner/repo", kind="github_readme", text="PyTorch model.")]
    classification, report, profile = interpret(_FakeLLM(), projects=projects)
    assert report.sent == 1 and report.returned == 1
    assert classification.normalized_industries == ["artificial intelligence"]
    assert profile.skills == ["Python"]
    assert profile.industries == ["artificial intelligence"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/test_profile.py tests/unit/interpretation/test_orchestrator.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/resume_builder/interpretation/profile.py
from __future__ import annotations

from pathlib import Path

from ..industry import IndustryClassification, _dedupe
from .models import UserProfile


def build_user_profile(classification: IndustryClassification) -> UserProfile:
    """The profile catcher: only skills + industry tags (no source links stored)."""
    industries = _dedupe([*classification.normalized_industries,
                          *(i for p in classification.projects for i in p.industries)])
    skills = _dedupe(s for p in classification.projects for s in p.skill_subtags)
    return UserProfile(skills=skills, industries=industries)


class ProfileSink:
    """Persists the user profile (skills + industries) as JSON. No github links stored."""

    def __init__(self, out_dir: Path) -> None:
        self._dir = Path(out_dir)
        self._dir.mkdir(parents=True, exist_ok=True)

    def save(self, profile: UserProfile) -> Path:
        path = self._dir / "user_profile.json"
        path.write_text(profile.model_dump_json(indent=2), encoding="utf-8")
        return path
```

```python
# legacy/python/resume_builder/interpretation/__init__.py  (replace file)
"""P3 — interpretation & tagging package."""
from __future__ import annotations

from ..industry import IndustryClassification
from ..llm.base import LLMProvider
from .compiler import compile_tags
from .middleman import RetrievalMiddleman
from .models import RetrievedSource, TagRunReport, UserProfile
from .normalizer import GlobalNormalizer
from .profile import ProfileSink, build_user_profile
from .runner import ParallelTagRunner
from .tagger import ProjectTagger

__all__ = [
    "RetrievedSource", "TagRunReport", "UserProfile",
    "RetrievalMiddleman", "ProjectTagger", "ParallelTagRunner",
    "compile_tags", "GlobalNormalizer", "ProfileSink", "build_user_profile",
    "interpret",
]


def interpret(
    llm: LLMProvider,
    projects=None,
    documents=None,
    posts=None,
    *,
    max_workers: int = 6,
    max_retries: int = 1,
) -> tuple[IndustryClassification, TagRunReport, UserProfile]:
    """Run the full P3 engine: gather -> parallel tag -> compile -> normalize -> profile."""
    sources = RetrievalMiddleman().gather(projects=projects, documents=documents, posts=posts)
    runner = ParallelTagRunner(ProjectTagger(llm), max_workers=max_workers, max_retries=max_retries)
    tagged, report = runner.run(sources)
    compiled = compile_tags(tagged)
    classification = GlobalNormalizer(llm).normalize(compiled)
    profile = build_user_profile(classification)
    return classification, report, profile
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/interpretation/ -v`
Expected: PASS (all interpretation tests green).

- [ ] **Step 5: Run the full repo suite + commit**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: PASS (no regressions).

```bash
git add legacy/python/resume_builder/interpretation/profile.py legacy/python/resume_builder/interpretation/__init__.py tests/unit/interpretation/test_profile.py tests/unit/interpretation/test_orchestrator.py
git commit -m "feat(interpretation): ProfileSink + interpret() orchestrator (user-profile catcher)"
```

---

## Notes for the implementer

- **Pipeline integration (deferred to a follow-up):** the existing `pipeline.py` `run_industry_auto` uses the older single-call `IndustryClassifier`. Swapping it to call `interpret(...)` is a separate integration task — keep this plan's engine standalone and stable first; wire the pipeline once the engine is green. The engine already returns an `IndustryClassification` that `plan_industry_resumes` (P4) consumes unchanged.
- **Live tagging uses the session model:** with no API key, the `interpret()` engine runs behind a `claude-session`/file-bridge `LLMProvider` (the same stand-in used for the resume builds) — the engine code itself needs no change.
- **Scan depth:** `projects` passed to `interpret()` come from P2 `gather_repo_sources(..., depth=...)`; the depth (readme/markdown/code) is chosen upstream per the user-selectable option.
