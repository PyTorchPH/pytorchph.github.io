# Department 03 — Intelligence

> **Functional module:** judge relevance and assemble the resume — extraction, synthesis, and
> the provider-agnostic LLM layer.
> **One-line mandate:** decide what belongs on the resume for *this* role, and write it well.

📊 Diagram: [`intelligence.puml`](intelligence.puml)

---

## What this department is responsible for

This is the **brain**. It takes raw material from Dept 02 and produces the finished `Resume`
object for Dept 04 to render. Three sub-modules:

1. **Extractors** (`extractors/`) — score/filter repos by role relevance → `Evidence[]`.
2. **Synthesizers** (`synthesizers/`) — assemble role + evidence + documents → `Resume`.
3. **LLM layer** (`llm/`) — one interface, many providers (Claude, GPT, clipboard, null).

Each stage is doubled (`static` and `ai`). This department owns the **quality** of the output —
prompt design, scoring, and the Harvard-principles editorial discipline all live here.

---

## Files owned

```
legacy/python/resume_builder/
├── extractors/
│   ├── base.py             # Extractor ABC
│   ├── static_extractor.py # regex keyword scoring (reads regex_patterns.json)
│   └── ai_extractor.py     # LLM relevance filtering + bullet generation
├── synthesizers/
│   ├── base.py             # Synthesizer ABC
│   ├── static_synth.py     # template-based assembly
│   └── ai_synth.py         # LLM-driven content generation
└── llm/
    ├── base.py             # LLMProvider ABC (complete + structured)
    ├── registry.py         # get_provider() factory
    ├── anthropic_provider.py
    ├── openai_provider.py
    ├── claude_session_provider.py  # clipboard paste, no API key
    └── null_provider.py    # no-op for static mode
```

---

## The public contract you must NOT break

```python
# extractors/base.py
class Extractor(ABC):
    def extract(self, repos: list[Repo], role: RoleSpec) -> list[Evidence]:
        """Score and filter repos. Return Evidence sorted by score desc."""

# synthesizers/base.py
class Synthesizer(ABC):
    def build(self, role: RoleSpec, repos: list[Repo],
              evidence: list[Evidence], documents: list[RawDocument]) -> Resume: ...

# llm/base.py
class LLMProvider(ABC):
    name: str
    def complete(self, prompt: str, system: str | None = None, max_tokens: int = 1024) -> str: ...
    def structured(self, prompt: str, schema: type[T],
                   system: str | None = None, max_tokens: int = 2048) -> T: ...
```

> Both `static` and `ai` implementations must return the **exact same shapes**. Dept 04 must
> never be able to tell which mode produced the `Resume`.

---

## How the LLM layer works (and why it's decoupled)

- Stages depend **only** on the `LLMProvider` ABC. They never import a concrete provider.
- Provider selection is a **registry concern** (`get_provider(settings)`), driven by settings /
  env (`RESUME_LLM_PROVIDER`). Swapping Claude ↔ GPT is config, not code.
- `structured()` has a default: ask the model for JSON, then tolerant-parse into a pydantic
  schema (handles ```json fences and stray prose). Providers may override with native tool-use.
- `NullProvider` is what `static` mode uses — calling it for generation should be a no-op /
  guarded path, never a crash.

---

## Editorial discipline (the actual product quality)

The whole value prop is **ruthless role-targeting**. This department enforces it:

- Inject `HARVARD_PRINCIPLES` (from Dept 01) into LLM system prompts.
- Keep an item only if a hiring manager **for the target role** would care. A compiler is not an
  ML project; a static website is not a security project — judge by what the work *is*, not by
  the languages listed.
- **Never pad.** Returning fewer (or zero) items is correct when nothing qualifies.
- When the LLM path fails, degrade gracefully to the keyword gate (the pipeline already wraps
  AI filters in try/except → keyword fallback; keep your stages compatible with that).

---

## Dos & Don'ts

✅ Keep prompts and scoring logic here; this is where output quality is won or lost.
✅ Make `ai` and `static` produce structurally identical `Resume`s.
✅ Add a new provider by subclassing `LLMProvider` + registering it.

🚫 Don't import `AnthropicProvider`/`OpenAIProvider` directly in a stage — use the ABC.
🚫 Don't hardcode API keys; read from settings/env (`get_provider`).
🚫 Don't invent role-pick or rendering logic here — stay in your lane (extract + synthesize).

---

## Hands off to

**Dept 04 (Rendering)** consumes the finished `Resume`. **Dept 01** does a final role-aware
re-filter on projects/achievements after your synthesis — keep your output filter-friendly.
