# Department 01 — Core / Orchestration

> **Functional module:** domain models, pipeline wiring, role picking, config.
> **One-line mandate:** own the contracts and the conductor. Everyone else plays to your score.

📊 Diagram: [`core-pipeline.puml`](core-pipeline.puml)

---

## What this department is responsible for

This is the **spine** of the product. It owns:

1. **The domain models** (`models.py`) — the canonical shapes every other department passes
   around. This is the single source of truth.
2. **The orchestrator** (`pipeline.py`) — the only code that knows about `Mode` (`ai` vs
   `static`) and decides which concrete stage to wire in.
3. **Role picking** (`role/`) — turning a user's role choice into a `RoleSpec`.
4. **Config + principles** (`config.py`, `principles.py`) — paths, settings, and the Harvard
   resume-quality guidance injected into LLM prompts.
5. **The CLI entrypoint** (`cli.py`) — the `resume-build` command.

---

## Files owned

```
legacy/python/resume_builder/
├── core/
│   ├── models.py      # CONSTITUTION — domain models shared by all stages
│   ├── config.py      # Settings, config + template paths
│   └── principles.py  # HARVARD_PRINCIPLES (LLM system-prompt guidance)
├── orchestration/
│   └── pipeline.py    # orchestrator; the only mode-aware code
├── cli.py             # Typer CLI entrypoint (`resume-build`)
└── role/
    ├── base.py        # RolePicker ABC
    ├── static_picker.py  # loads RoleSpec from config/roles.json
    └── ai_picker.py      # LLM-driven role clarification
config/
├── roles.json         # role definitions (static mode)
└── regex_patterns.json
```

---

## The public contract you must NOT break

These are the shapes and signatures the rest of the system depends on. Change them only with a
cross-department announcement.

```python
# models.py — the constitution
class RoleSpec(BaseModel):   # id, label, keywords, must_have_skills, nice_to_have, summary_hint
class Resume(BaseModel):     # role, contact, summary, skills, experience, projects,
                             # education, certifications, achievements, generated_on
class Repo / RawDocument / Evidence / ContactInfo / Resume* sub-models

# role/base.py
class RolePicker(ABC):
    def pick(self, selection: str) -> RoleSpec: ...
    def list_available(self) -> list[RoleSpec]: ...

# pipeline.py
class Pipeline:
    def run(self, inputs: BuildInputs) -> PipelineResult: ...
```

The 5-stage call order inside `Pipeline.run()` is also a contract:

```
role = role_picker.pick(...)        # Stage 1  (this dept)
repos = github.collect(...)         # Stage 2  (Dept 02)
evidence = extractor.extract(...)   # Stage 3  (Dept 03)
resume = synthesizer.build(...)     # Stage 4  (Dept 03)
... role-aware re-filter ...        #          (this dept)
paths = renderer.write(...)         # Stage 5  (Dept 04)
```

---

## How `static` vs `ai` is decided (your responsibility)

`Pipeline` has private factories that pick the concrete implementation per `Mode`:

| Factory | `static` → | `ai` → |
|---------|-----------|--------|
| `_make_role_picker` | `StaticRolePicker(roles_path)` | `AIRolePicker(llm)` |
| `_make_extractor` | `StaticExtractor(regex_path)` | `AIExtractor(llm)` |
| `_make_synthesizer` | `StaticSynthesizer()` | `AISynthesizer(llm)` |
| `_resolve_llm` | `NullProvider()` | `get_provider(settings)` |

> This is the **only** place `if mode == ...` is allowed. If you find a mode check in another
> department, that's a bug — escalate it here.

---

## Extra responsibility: role-aware re-filtering

After synthesis, `pipeline.py` runs a second pass that drops off-target projects and
achievements (`_filter_projects_by_role`, `_filter_achievements_by_role`). With a real LLM it
uses a strict editor verdict; otherwise it falls back to a word-boundary keyword gate. **Never
pad sections** — empty is correct when nothing qualifies.

---

## Dos & Don'ts

✅ Keep `models.py` minimal, typed, and documented. It's read by everyone.
✅ Announce any model/interface change to all departments before merging.
✅ Keep mode logic confined to `pipeline.py`.

🚫 Don't import a concrete vendor/renderer/extractor — depend on the abstract base.
🚫 Don't add business logic to models (they are data contracts, not behavior).
🚫 Don't let `cli.py` grow logic; it should only parse args and call `Pipeline`.

---

## Hands off to

- **Dept 02** (Sources) for raw evidence collection.
- **Dept 03** (Intelligence) for filtering + assembly.
- **Dept 04** (Rendering) for output.
- Consumed by **Dept 05** (Web) which calls `Pipeline.run()`.
