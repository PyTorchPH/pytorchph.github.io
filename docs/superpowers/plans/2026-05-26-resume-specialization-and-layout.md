# Resume Specialization & Two-Column Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each role's resume show only genuinely-relevant projects (with a new Systems/Compilers role), and render a formal two-column layout — all inside the Python pipeline.

**Architecture:** Mirror the existing achievements filter: add `_filter_projects_by_role` to `pipeline.py` (AI verdict when an LLM is available, deterministic keyword gate otherwise), wire it into `Pipeline.run()`, tighten the static extractor's fallback scoring, add a `systems-compilers` role, and rework the HTML/reportlab/LaTeX renderers into two columns.

**Tech Stack:** Python 3.13, pydantic, Jinja2, reportlab, pytest.

---

## Reused building blocks (already in `pipeline.py`)

These helpers already exist from the achievements work and MUST be reused (DRY):
- `_role_terms(role) -> list[str]` — lowercased keywords + must_have + nice_to_have.
- `_keyword_relevant(text, terms) -> bool` — word-boundary, case-insensitive match.
- The `NullProvider` import and the `isinstance(llm, NullProvider)` fallback pattern.
- The verdict pattern: a pydantic model + `llm.structured(prompt, schema=..., system=...)`.

---

## Task 1: Add the `systems-compilers` role

**Files:**
- Modify: `config/roles.json` (top-level object is `{"roles": [ ... ]}`)
- Test: `tests/unit/test_role_picker.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/test_role_picker.py`:

```python
def test_systems_compilers_role_loads(config_dir):
    import json
    data = json.loads((config_dir / "roles.json").read_text(encoding="utf-8"))
    ids = {r["id"] for r in data["roles"]}
    assert "systems-compilers" in ids
    role = next(r for r in data["roles"] if r["id"] == "systems-compilers")
    assert "compiler" in [k.lower() for k in role["keywords"]]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_role_picker.py::test_systems_compilers_role_loads -v`
Expected: FAIL (`systems-compilers` not in ids).

- [ ] **Step 3: Add the role**

Append this object to the `"roles"` array in `config/roles.json` (before the closing `]`, after a comma on the previous entry):

```json
{
  "id": "systems-compilers",
  "label": "Systems / Compilers / Languages Engineer",
  "keywords": [
    "compiler", "interpreter", "parser", "lexer", "AST", "code generation",
    "bytecode", "virtual machine", "C++", "CMake", "assembly",
    "systems programming", "language design", "low-level"
  ],
  "must_have_skills": ["C/C++", "systems programming", "data structures"],
  "nice_to_have": ["LLVM", "reverse engineering", "operating systems"],
  "summary_hint": "Low-level systems and language tooling — compilers, interpreters, and performance-critical C/C++."
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_role_picker.py::test_systems_compilers_role_loads -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config/roles.json tests/unit/test_role_picker.py
git commit -m "feat: add systems-compilers role"
```

---

## Task 2: Project verdict models + keyword fallback filter

**Files:**
- Modify: `legacy/python/resume_builder/pipeline.py`
- Test: `tests/unit/test_project_filter.py` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/test_project_filter.py`:

```python
from __future__ import annotations

from resume_builder.models import ResumeProject, RoleSpec
from resume_builder import pipeline as P


def _role(**kw) -> RoleSpec:
    base = dict(id="r", label="R", keywords=[], must_have_skills=[], nice_to_have=[])
    base.update(kw)
    return RoleSpec(**base)


def test_keyword_fallback_keeps_relevant_drops_unrelated():
    role = _role(keywords=["compiler", "C++"])
    projects = [
        ResumeProject(name="Andrew-mini-compiler", description="A small compiler", tech=["C++"]),
        ResumeProject(name="codespaces-react", description="A React starter", tech=["JavaScript"]),
    ]
    kept = P._filter_projects_by_role(projects, role, llm=None)
    names = [p.name for p in kept]
    assert "Andrew-mini-compiler" in names
    assert "codespaces-react" not in names


def test_keyword_fallback_empty_when_nothing_matches():
    role = _role(keywords=["pytorch", "tensorflow"])
    projects = [ResumeProject(name="codespaces-react", description="React", tech=["JavaScript"])]
    assert P._filter_projects_by_role(projects, role, llm=None) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_project_filter.py -v`
Expected: FAIL (`_filter_projects_by_role` not defined).

- [ ] **Step 3: Add models + fallback filter to `pipeline.py`**

After the achievements filter helpers (after `_filter_with_ai`), add:

```python
# ---- role-aware project filtering -----------------------------------------------


class _ProjectVerdict(BaseModel):
    """One LLM judgement about a candidate project."""

    index: int = Field(..., description="Index of the candidate in the input list.")
    relevant: bool = Field(
        ..., description="True only if the project genuinely demonstrates the TARGET ROLE."
    )
    focused_description: str | None = Field(
        None,
        description="The description rewritten for the target role, or null if not relevant.",
    )


class _ProjectVerdicts(BaseModel):
    items: list[_ProjectVerdict] = Field(default_factory=list)


_PROJECT_SYSTEM = (
    "You are a strict resume editor specializing one resume to one target role. "
    "Keep a project ONLY when it genuinely demonstrates skills a hiring manager for the "
    "TARGET ROLE would value. A project may be relevant to more than one role, but a "
    "compiler is not a machine-learning project and a static website is not a security "
    "project — judge by what the project actually is, not by which languages it lists. "
    "When kept, rewrite focused_description to emphasize the role-relevant angle. If it "
    "does not clearly belong on a resume for THIS role, mark it not relevant."
)


def _filter_projects_by_role(
    projects: list[ResumeProject],
    role: RoleSpec,
    llm: LLMProvider | None,
) -> list[ResumeProject]:
    """Keep only projects relevant to the target role (multi-role allowed).

    AI verifies and re-frames when a real provider is available; otherwise a keyword
    gate over name + tech + description is used. Returns [] when nothing qualifies.
    """
    if not projects:
        return []

    use_ai = llm is not None and not isinstance(llm, NullProvider)
    if use_ai:
        try:
            return _filter_projects_with_ai(projects, role, llm)
        except Exception:  # noqa: BLE001 — any LLM/parse failure falls back to keywords
            log.warning("AI project filter failed; falling back to keyword gate.")

    terms = _role_terms(role)
    return [
        p
        for p in projects
        if _keyword_relevant(f"{p.name}\n{' '.join(p.tech)}\n{p.description}", terms)
    ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_project_filter.py -v`
Expected: FAIL on import of `_filter_projects_with_ai` (defined next task) — so for THIS step also add a temporary stub so the fallback path imports cleanly:

Add directly below `_filter_projects_by_role` (will be fully implemented in Task 3):

```python
def _filter_projects_with_ai(
    projects: list[ResumeProject],
    role: RoleSpec,
    llm: LLMProvider,
) -> list[ResumeProject]:
    raise NotImplementedError  # implemented in Task 3
```

Re-run: `python -m pytest tests/unit/test_project_filter.py -v`
Expected: PASS (both tests use `llm=None`, so the AI branch is never taken).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/pipeline.py tests/unit/test_project_filter.py
git commit -m "feat: project role-relevance keyword filter"
```

---

## Task 3: AI project filter implementation

**Files:**
- Modify: `legacy/python/resume_builder/pipeline.py` (replace the Task 2 stub)
- Test: `tests/unit/test_project_filter.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/test_project_filter.py`:

```python
from resume_builder.llm.base import LLMProvider


class _StubLLM(LLMProvider):
    name = "stub"

    def __init__(self, keep_indices: dict[int, str | None]):
        self._keep = keep_indices

    def complete(self, *a, **k):
        raise NotImplementedError

    def structured(self, prompt, schema, system=None, max_tokens=2048):
        items = [
            {"index": i, "relevant": i in self._keep, "focused_description": self._keep.get(i)}
            for i in range(prompt.count("[") )
        ]
        return schema.model_validate({"items": items})


def test_ai_filter_keeps_only_verdict_relevant_and_reframes():
    role = _role(keywords=["compiler"])
    projects = [
        ResumeProject(name="Andrew-mini-compiler", description="raw", tech=["C++"]),
        ResumeProject(name="codespaces-react", description="raw", tech=["JS"]),
    ]
    llm = _StubLLM({0: "A hand-written compiler with lexer, parser, and codegen."})
    kept = P._filter_projects_by_role(projects, role, llm=llm)
    assert [p.name for p in kept] == ["Andrew-mini-compiler"]
    assert kept[0].description == "A hand-written compiler with lexer, parser, and codegen."
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_project_filter.py::test_ai_filter_keeps_only_verdict_relevant_and_reframes -v`
Expected: FAIL (`NotImplementedError` from the stub).

- [ ] **Step 3: Replace the stub with the real implementation**

Replace the `_filter_projects_with_ai` stub in `pipeline.py` with:

```python
def _filter_projects_with_ai(
    projects: list[ResumeProject],
    role: RoleSpec,
    llm: LLMProvider,
) -> list[ResumeProject]:
    listing = "\n".join(
        f"[{i}] {p.name} — tech: {', '.join(p.tech)}\n    {(p.description or '').strip()[:400]}"
        for i, p in enumerate(projects)
    )
    prompt = (
        f"TARGET ROLE: {role.label}\n"
        f"Role keywords: {', '.join(role.keywords)}\n"
        f"Must-have skills: {', '.join(role.must_have_skills)}\n\n"
        f"Candidate projects:\n{listing}\n\n"
        "Return a verdict for every index."
    )
    verdicts = llm.structured(
        prompt, schema=_ProjectVerdicts, system=_PROJECT_SYSTEM, max_tokens=2048
    )
    kept: list[ResumeProject] = []
    for v in verdicts.items:
        if not v.relevant or not (0 <= v.index < len(projects)):
            continue
        src = projects[v.index]
        kept.append(
            src.model_copy(update={"description": v.focused_description.strip()})
            if v.focused_description and v.focused_description.strip()
            else src
        )
    return kept
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/test_project_filter.py -v`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/resume_builder/pipeline.py tests/unit/test_project_filter.py
git commit -m "feat: AI-verified project role filter"
```

---

## Task 4: Wire filter into the pipeline + tighten static fallback

**Files:**
- Modify: `legacy/python/resume_builder/pipeline.py` (`Pipeline.run`)
- Modify: `legacy/python/resume_builder/extractors/static_extractor.py:23` (raise `min_score`)
- Test: `tests/integration/test_pipeline_static.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/test_pipeline_static.py` (a focused assertion that an unrelated
project is dropped for an ML role). Use the existing fixtures/patterns in that file; the
minimal new test:

```python
def test_projects_filtered_by_role_static(monkeypatch):
    from resume_builder.models import ResumeProject, RoleSpec
    from resume_builder import pipeline as P

    role = RoleSpec(id="ml-engineer", label="ML", keywords=["pytorch", "LLM"],
                    must_have_skills=["python"], nice_to_have=[])
    projects = [
        ResumeProject(name="MusicScanIter", description="PyTorch model trainer", tech=["Python"]),
        ResumeProject(name="Andrew-mini-compiler", description="A C++ compiler", tech=["C++"]),
    ]
    kept = P._filter_projects_by_role(projects, role, llm=None)
    assert "Andrew-mini-compiler" not in [p.name for p in kept]
```

- [ ] **Step 2: Run test to verify it fails (or passes trivially) then wire the pipeline**

Run: `python -m pytest tests/integration/test_pipeline_static.py::test_projects_filtered_by_role_static -v`
Expected: PASS at filter level (filter already works). Now ensure the pipeline calls it.

- [ ] **Step 3: Wire into `Pipeline.run()`**

In `legacy/python/resume_builder/pipeline.py`, in `run()`, immediately after
`resume = self.synthesizer.build(role, repos, evidence, documents)` add:

```python
        resume.projects = _filter_projects_by_role(resume.projects, role, self.llm)
```

- [ ] **Step 4: Tighten the static fallback discrimination**

In `legacy/python/resume_builder/extractors/static_extractor.py`, change the constructor default
on line 23 from `min_score: float = 1.0` to:

```python
    def __init__(self, regex_patterns_path: Path, min_score: float = 2.5) -> None:
```

- [ ] **Step 5: Run the static pipeline test suite**

Run: `python -m pytest tests/integration/test_pipeline_static.py -v`
Expected: PASS. If a pre-existing test asserted a now-filtered project count, update its
expectation to match the stricter `min_score` (document the new count inline).

- [ ] **Step 6: Commit**

```bash
git add legacy/python/resume_builder/pipeline.py legacy/python/resume_builder/extractors/static_extractor.py tests/integration/test_pipeline_static.py
git commit -m "feat: apply project role filter in pipeline; tighten static min_score"
```

---

## Task 5: AI synth prompt — projects per role

**Files:**
- Modify: `legacy/python/resume_builder/synthesizers/ai_synth.py` (the prompt tail, near the
  `"Compose the final Resume..."` instruction)

- [ ] **Step 1: Update the instruction**

In `_build_prompt`, change the projects guidance so the model only proposes role-relevant
projects. Replace the sentence `"projects` (use the GitHub evidence), "` portion by
appending after the existing education sentence:

```python
            "For `projects`, include only those that genuinely demonstrate THIS role; "
            "omit projects whose real purpose is unrelated to the role even if they share "
            "a programming language. "
```

(Insert this string literal immediately before the `"Use generated_on = today."` line.)

- [ ] **Step 2: Verify it still builds**

Run: `python -c "import resume_builder.synthesizers.ai_synth"`
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add legacy/python/resume_builder/synthesizers/ai_synth.py
git commit -m "feat: instruct AI synth to keep only role-relevant projects"
```

---

## Task 6: Two-column HTML template

**Files:**
- Modify: `config/templates/resume.html.j2`
- Test: `tests/unit/test_renderers.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/test_renderers.py` (mirror the existing HtmlRenderer test setup; build
a minimal `Resume` via the existing helper/fixture in that file). Minimal assertion:

```python
def test_html_is_two_column(templates_dir):
    from resume_builder.renderers.html_renderer import HtmlRenderer
    from resume_builder.models import Resume, RoleSpec, ContactInfo
    resume = Resume(
        role=RoleSpec(id="r", label="R", keywords=[], must_have_skills=[], nice_to_have=[]),
        contact=ContactInfo(name="Test User"),
        summary="S", skills=["Python"], projects=[], experience=[], education=[],
    )
    html = HtmlRenderer(templates_dir).render(resume)
    assert "grid-template-columns" in html
    assert 'class="sidebar"' in html and 'class="main"' in html
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_renderers.py::test_html_is_two_column -v`
Expected: FAIL (no `grid-template-columns`).

- [ ] **Step 3: Rework the layout**

In `config/templates/resume.html.j2`:

(a) In `<style>`, after the `.sheet{...}` rule, add the grid container and column styles:

```css
  .layout{display:grid; grid-template-columns: 34% 1fr; gap:0 22px; margin-top:10px;}
  .sidebar{padding-right:18px; border-right:1px solid var(--rule);}
  .main{min-width:0;}
  @media print{ .layout{gap:0 16px;} }
```

(b) Replace the body block so the header stays full-width and the sections split into
`.main` and `.sidebar`. The structure becomes:

```html
<main class="sheet">
  <header> ...existing name/headline/contact... </header>

  <div class="layout">
    <div class="main">
      {# Summary #}{# Experience #}{# Projects #}{# Achievements #}
    </div>
    <aside class="sidebar">
      {# Skills #}{# Certifications #}{# Education (last) #}
    </aside>
  </div>
</main>
```

Move the existing `{% if resume.summary %}`, `experience`, `projects`, `achievements`
section blocks (unchanged) inside `.main`, and move the `skills`, `certifications`,
`education` blocks inside `.sidebar`. Keep DOM order: `.main` appears before `.sidebar`
in the markup so text extraction reads content first.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_renderers.py::test_html_is_two_column -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config/templates/resume.html.j2 tests/unit/test_renderers.py
git commit -m "feat: two-column HTML resume layout"
```

---

## Task 7: Two-column reportlab PDF

**Files:**
- Modify: `legacy/python/resume_builder/renderers/pdf_renderer.py` (`_render_reportlab`)
- Test: `tests/unit/test_renderers.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/test_renderers.py`:

```python
def test_pdf_renders_two_frames(templates_dir):
    from resume_builder.renderers.pdf_renderer import PdfRenderer
    from resume_builder.models import Resume, RoleSpec, ContactInfo, ResumeProject
    resume = Resume(
        role=RoleSpec(id="r", label="R", keywords=[], must_have_skills=[], nice_to_have=[]),
        contact=ContactInfo(name="Test User"),
        summary="A summary.", skills=["Python", "C++"],
        projects=[ResumeProject(name="Proj", description="d", tech=["Python"])],
        experience=[], education=[],
    )
    pdf = PdfRenderer(templates_dir).render(resume)
    assert pdf[:4] == b"%PDF"
    assert len(pdf) > 800
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `python -m pytest tests/unit/test_renderers.py::test_pdf_renders_two_frames -v`
Expected: PASS today (single column). This test is a render-smoke guard; the next step
changes the internal layout to two frames while keeping it green.

- [ ] **Step 3: Convert `_render_reportlab` to a two-frame layout**

Replace the `SimpleDocTemplate` construction and `doc.build(story)` with a
`BaseDocTemplate` that has a full-width header frame stacked above two body frames
(sidebar + main). Use `FrameBreak` to move between frames. Concretely, in
`_render_reportlab`:

```python
        from reportlab.platypus import (
            BaseDocTemplate, Frame, PageTemplate, FrameBreak,
            Paragraph, Spacer,
        )
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import inch

        buf = BytesIO()
        pw, ph = letter
        lm = rm = 0.55 * inch
        tm = bm = 0.45 * inch
        header_h = 0.9 * inch
        gutter = 0.2 * inch
        usable_w = pw - lm - rm
        side_w = usable_w * 0.34
        main_w = usable_w - side_w - gutter
        body_top = ph - tm - header_h
        body_h = body_top - bm

        header_frame = Frame(lm, ph - tm - header_h, usable_w, header_h, id="header",
                             leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        side_frame = Frame(lm, bm, side_w, body_h, id="side",
                           leftPadding=0, rightPadding=8, topPadding=0, bottomPadding=0)
        main_frame = Frame(lm + side_w + gutter, bm, main_w, body_h, id="main",
                          leftPadding=8, rightPadding=0, topPadding=0, bottomPadding=0)

        doc = BaseDocTemplate(buf, pagesize=letter)
        doc.addPageTemplates([PageTemplate(id="two-col",
                              frames=[header_frame, side_frame, main_frame])])
```

Then build the story in frame order: header content, `FrameBreak()`, sidebar content
(Skills, Certifications, Education), `FrameBreak()`, main content (Summary, Experience,
Projects, Achievements). Reuse the existing `h1`, `h2`, `body` `ParagraphStyle`s. End with
`doc.build(story)` and `return buf.getvalue()`. Keep all existing per-section rendering
loops; only their grouping/order and the surrounding frame scaffold change.

- [ ] **Step 4: Run renderer tests**

Run: `python -m pytest tests/unit/test_renderers.py -v`
Expected: PASS.

- [ ] **Step 5: Render-smoke all roles from existing JSON**

Run:
```bash
python -c "from pathlib import Path; from resume_builder.models import Resume; from resume_builder.renderers.pdf_renderer import PdfRenderer; \
[PdfRenderer(Path('config/templates')).render(Resume.model_validate_json(Path('out/resumes',r,'resume.json').read_text(encoding='utf-8'))) for r in ['fullstack-web','ml-engineer','_default']]; print('ok')"
```
Expected: prints `ok` (no exceptions).

- [ ] **Step 6: Commit**

```bash
git add legacy/python/resume_builder/renderers/pdf_renderer.py tests/unit/test_renderers.py
git commit -m "feat: two-column reportlab PDF layout"
```

---

## Task 8: LaTeX two-column (paracol)

**Files:**
- Modify: `config/templates/resume.tex.j2`
- Test: `tests/unit/test_renderers.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/test_renderers.py`:

```python
def test_latex_uses_paracol(templates_dir):
    from resume_builder.renderers.latex_renderer import LatexRenderer
    from resume_builder.models import Resume, RoleSpec, ContactInfo
    resume = Resume(
        role=RoleSpec(id="r", label="R", keywords=[], must_have_skills=[], nice_to_have=[]),
        contact=ContactInfo(name="Test User"), summary="S", skills=["Python"],
        projects=[], experience=[], education=[],
    )
    tex = LatexRenderer(templates_dir).render(resume)
    assert "paracol" in tex
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_renderers.py::test_latex_uses_paracol -v`
Expected: FAIL.

- [ ] **Step 3: Add paracol two-column**

In `config/templates/resume.tex.j2`:
(a) Add `\usepackage{paracol}` and `\columnratio{0.34}` to the preamble (after the
existing `\usepackage` lines).
(b) After the centered header block, wrap the body in `\begin{paracol}{2} ... \end{paracol}`.
Put Skills, Certifications, Education in the left column (`\switchcolumn` separates them
from) Summary, Experience, Projects, Achievements in the right column. Use `\switchcolumn`
to move from left to right.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_renderers.py::test_latex_uses_paracol -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config/templates/resume.tex.j2 tests/unit/test_renderers.py
git commit -m "feat: two-column LaTeX layout via paracol"
```

---

## Task 9: Full regression + render all roles

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `python -m pytest -q`
Expected: all pass. Fix any test whose expectation legitimately changed (e.g. project
counts under stricter filtering) by updating the expected value with a one-line comment.

- [ ] **Step 2: Re-render every role from existing JSON (smoke)**

Run:
```bash
python -c "from pathlib import Path; from resume_builder.models import Resume; \
from resume_builder.renderers.html_renderer import HtmlRenderer; \
from resume_builder.renderers.pdf_renderer import PdfRenderer; \
from resume_builder.renderers.latex_renderer import LatexRenderer; \
from resume_builder.renderers.markdown_renderer import MarkdownRenderer; \
tpl=Path('config/templates'); \
[ (HtmlRenderer(tpl).render(r), PdfRenderer(tpl).render(r), LatexRenderer(tpl).render(r), MarkdownRenderer(tpl).render(r)) \
  for r in (Resume.model_validate_json(Path('out/resumes',x,'resume.json').read_text(encoding='utf-8')) \
  for x in ['fullstack-web','ml-engineer','cybersecurity-redteam','cybersecurity-blueteam','_default']) ]; print('all rendered')"
```
Expected: prints `all rendered`.

- [ ] **Step 3: Commit any test-expectation updates**

```bash
git add -A
git commit -m "test: update expectations for role-filtered projects and two-column layout"
```

---

## Self-Review notes

- Spec WS1 (new role) → Task 1. Spec WS1 (AI filter, multi-role, fallback) → Tasks 2–4.
  Spec WS1 (synth prompt) → Task 5. Spec WS2 (HTML/PDF/LaTeX two-column, Markdown linear)
  → Tasks 6–8. Markdown intentionally unchanged (cannot do columns) — covered by the
  render smoke in Task 9.
- Reused helpers (`_role_terms`, `_keyword_relevant`, `NullProvider` branch) keep the
  project filter DRY against the achievements filter.
- Method/type names consistent across tasks: `_filter_projects_by_role`,
  `_filter_projects_with_ai`, `_ProjectVerdict`, `_ProjectVerdicts`.
