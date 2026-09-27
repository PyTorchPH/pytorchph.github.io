# Resume Specialization & Two-Column Layout — Design Spec

**Date:** 2026-05-26
**Status:** Approved (design)

## Problem

1. **Projects are not role-segregated.** Almost every GitHub repo appears in every
   role's resume because project→role matching is loose substring scoring over a
   haystack that includes the README and language list. `Andrew-mini-compiler` (a
   compiler) shows up under Machine Learning, Web, and Security — none of which fit.
2. **The document should be more formal and readable.** The current single-column
   serif layout is acceptable but the user wants a polished two-column presentation.

Both fixes MUST live inside the Python system (the `resume_builder` pipeline and
templates) — automated, not produced by hand.

## Goals

- Each project appears only in roles where it is genuinely relevant (multi-role OK).
- A project that fits none of the target roles is excluded from those roles.
- Add a role where systems/compiler/low-level projects genuinely belong.
- Render a two-column, formal, readable resume (HTML + PDF primarily).

## Non-Goals

- No new scraping sources or data model changes beyond what's needed.
- Markdown stays single-flow (the format cannot express columns).
- Do not install `pdflatex`; the real PDF path is reportlab.

---

## Workstream 1 — Project → Role Classification

### 1a. New role: `systems-compilers`

Add to `config/roles.json`:

- **id:** `systems-compilers`
- **label:** `Systems / Compilers / Languages Engineer`
- **keywords:** `compiler, interpreter, parser, lexer, AST, code generation, bytecode,
  virtual machine, C++, CMake, assembly, systems programming, language design, low-level`
- **must_have_skills:** `C/C++`, `systems programming`, `data structures`
- **nice_to_have:** `LLVM`, `reverse engineering`, `operating systems`

Genuinely-fitting projects: `Andrew-mini-compiler`, `Egoist`, `NeoTerritory`, the
assembly OS (from the candidate's CV).

### 1b. AI-verified project relevance filter

Mirror the achievements filter. Add to `pipeline.py`:

```
_filter_projects_by_role(projects, role, llm) -> list[ResumeProject]
```

- **AI mode** (real provider): one structured LLM call per role. Input = each project's
  name, tech list, description, and a README snippet. The model returns a verdict per
  project: `relevant: bool` and an optional `focused_description` rewritten for the
  target role. Keep only relevant projects. **Multi-role allowed** — a project may be
  kept by more than one role if genuinely relevant (e.g. `rdtii-autoextract` for both
  ML and Full-Stack).
- **Static / null mode** (no LLM): deterministic keyword/score gate. Raise the
  effective discrimination so unrelated repos are dropped — tighten
  `StaticExtractor._min_score` and/or reduce README-driven false positives (e.g. weight
  name/description/topics above README body). Conservative: when nothing qualifies the
  section may be small or empty (never padded).
- Wire into `Pipeline.run()` after synthesis, before rendering:
  `resume.projects = _filter_projects_by_role(resume.projects, role, self.llm)`.

Reuse the verdict-schema pattern (`pydantic` models + `llm.structured`) and the
`isinstance(llm, NullProvider)` fallback branch already used by
`_filter_achievements_by_role`. On any LLM/parse error, fall back to the keyword gate.

### Expected outcome

| Project | Before (all roles) | After |
|---|---|---|
| Andrew-mini-compiler | ML, Web, Security | Systems only |
| rdtii-autoextract | all | ML + Full-Stack |
| Legarda-Workshop (AWS/web) | all | Full-Stack only |
| Egoist (C++) | several | Systems only |

---

## Workstream 2 — Two-Column Formal & Readable Layout

### Layout

Full-width header (name + headline + contact line), then a two-column body:

- **Sidebar (~34%):** Skills, Education, Certifications.
- **Main (~66%):** Summary, Experience, Projects, Achievements.

(Contact can live in the header banner; Education stays at the end of the sidebar to
honor the earlier "education is supporting, at the end" decision.)

### Typography & style

- Sans-serif stack (Inter / Helvetica Neue / Arial).
- Clear size hierarchy; navy accent `#243b6b` on the sidebar.
- Keep the tightened vertical spacing from prior work.

### Per-format plan

| Format | Two-column | Mechanism |
|---|---|---|
| HTML (`resume.html.j2`) | Yes | CSS Grid. **Linear DOM order** (main content first in markup; grid places sidebar) so ATS and screen readers read it correctly. Print CSS for A4. |
| PDF (`pdf_renderer.py`, reportlab) | Yes | Two-frame `PageTemplate` (sidebar frame + main frame). The real PDF path; highest implementation effort. |
| LaTeX (`resume.tex.j2`) | Yes | `paracol` two-column. Dormant (no pdflatex installed) but kept consistent. |
| Markdown (`resume.md.j2`) | No | Single flow; education stays last. |

### ATS safety

The two-column look must not break text extraction: keep the underlying text in a
logical reading order, avoid text-as-image and layout-only tables that scramble parsing.

---

## Files touched (anticipated)

- `config/roles.json` — new role.
- `legacy/python/resume_builder/pipeline.py` — `_filter_projects_by_role` + wiring.
- `legacy/python/resume_builder/extractors/static_extractor.py` — tighter fallback scoring.
- `legacy/python/resume_builder/synthesizers/ai_synth.py` — prompt note (projects per role).
- `config/templates/resume.html.j2` — two-column.
- `legacy/python/resume_builder/renderers/pdf_renderer.py` — two-frame reportlab layout.
- `config/templates/resume.tex.j2` — paracol.
- Tests for the new filter (relevant kept, irrelevant dropped, multi-role, empty-safe).

## Testing

- Unit: `_filter_projects_by_role` keyword fallback — keeps relevant, drops unrelated,
  multi-role, empty when nothing matches.
- Unit: new role loads from `roles.json` and scores its fitting projects above threshold.
- Render smoke: HTML/PDF render without error for every role; section/column order
  correct; education last in sidebar.
