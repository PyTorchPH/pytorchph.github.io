# `synthesizers/` — Resume Assembly (Stage 4)

Assembles the role, evidence, repos, and documents into the canonical `Resume` model.
Part of **Department 03 (Intelligence)**.

> 📖 [Dept 03 — Intelligence](../../../../docs/departments/03-intelligence/README.md)

## Contract

```python
class Synthesizer(ABC):
    def build(self, role: RoleSpec, repos: list[Repo],
              evidence: list[Evidence], documents: list[RawDocument]) -> Resume
```

## Process

```mermaid
flowchart TD
    In[RoleSpec + repos + Evidence + RawDocument] --> Mode{which synthesizer?}
    Mode -->|static| SS[StaticSynthesizer]
    Mode -->|ai| AS[AISynthesizer]
    SS --> T[template-based assembly]
    AS --> LLM[[LLMProvider]]
    LLM --> Gen[summary + bullets + skills]
    T --> Build
    Gen --> Build[populate Resume sections]
    Build --> R[Resume<br/>contact, summary, skills, projects,<br/>experience, education, achievements]
    R --> Pipe[[Dept 01: role-aware re-filter]]
    Pipe --> Rend[[renderers/]]
```

## Files

| File | Role |
|---|---|
| `base.py` | `Synthesizer` ABC |
| `static_synth.py` | Template-based assembly (no LLM) |
| `ai_synth.py` | LLM-driven content generation |

## Rules

`ai` and `static` must produce **structurally identical** `Resume` objects. Never pad sections —
empty is correct when nothing qualifies. Apply Harvard principles for impact-focused bullets.
After you build, Dept 01 runs a final role-aware filter on projects/achievements — keep output
filter-friendly.
