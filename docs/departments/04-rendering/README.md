# Department 04 — Rendering / Output

> **Functional module:** turn the canonical `Resume` model into real files.
> **One-line mandate:** one input shape, many beautiful outputs. Stay pure.

📊 Diagram: [`rendering.puml`](rendering.puml)

---

## What this department is responsible for

The **last mile**. You consume exactly one thing — the `Resume` model — and emit files in five
formats. This is the most self-contained department: no LLM, no scraping, no mode logic. Great
surface for a junior dev to own end-to-end.

| Format | Renderer | Backed by |
|--------|----------|-----------|
| LaTeX | `LatexRenderer` (`.tex`) | `config/templates/resume.latex.j2` |
| HTML | `HtmlRenderer` (`.html`) | `config/templates/resume.html.j2` |
| Markdown | `MarkdownRenderer` (`.md`) | `config/templates/resume.md.j2` |
| JSON | `JsonRenderer` (`.json`) | direct serialization |
| PDF | `PdfRenderer` (`.pdf`) | ReportLab (2-column) / LaTeX→PDF |

---

## Files owned

```
legacy/python/resume_builder/renderers/
├── base.py              # Renderer ABC + shared write()
├── registry.py          # get_renderer(fmt, templates_dir)
├── latex_renderer.py
├── html_renderer.py
├── markdown_renderer.py
├── json_renderer.py
└── pdf_renderer.py
config/templates/
├── resume.latex.j2
├── resume.html.j2
└── resume.md.j2
```

---

## The public contract you must NOT break

```python
# renderers/base.py
class Renderer(ABC):
    extension: str = ""
    def render(self, resume: Resume) -> str | bytes: ...        # subclasses implement THIS
    def write(self, resume: Resume, out_dir: Path,
              stem: str = "resume") -> Path:                     # shared; usually don't override
```

- `render()` is the only method a subclass must implement.
- `write()` is shared base logic: it `mkdir -p`s the output dir, picks `wb` vs `utf-8` based on
  whether `render()` returned `bytes` or `str`, writes `<stem>.<extension>`, and returns the
  `Path`. Don't reimplement it unless a format truly needs different file handling.
- `get_renderer(fmt, templates_dir)` is how Dept 01 looks you up by format string. Register new
  formats there.

---

## Critical design rules

### 1. Renderers are PURE
Input is `Resume`, output is a file. **No data fetching, no LLM calls, no role logic, no
mutation of the `Resume`.** If you find yourself needing more data, the gap belongs in Dept 03,
not here.

### 2. Mode-blind
You must never know or care whether the `Resume` came from `static` or `ai`. Same shape, same
render.

### 3. Templates are data, not code
Layout/wording lives in `config/templates/*.j2`. Adding a visual variant should be a template
edit, not a renderer rewrite where possible.

### 4. Adding a format = subclass + register
Subclass `Renderer`, set `extension`, implement `render()`, register in `registry.py`. Nothing
else in the system should change.

---

## Dos & Don'ts

✅ Keep `render()` deterministic and side-effect-free (besides the file `write()` does).
✅ Handle missing optional sections gracefully (empty skills/experience/etc. are valid).
✅ Set explicit dimensions / safe escaping in templates (LaTeX special chars, HTML escaping).

🚫 Don't fetch anything or call an LLM.
🚫 Don't mutate the `Resume` you were handed (immutability — return new strings/bytes).
🚫 Don't branch on build mode.

---

## Hands off to

Nothing downstream — you produce the **final artifacts** in `out/`. Dept 01 (`render_only`,
`_render_all`) and Dept 05 (web `/build`) both call into you via `get_renderer`.
