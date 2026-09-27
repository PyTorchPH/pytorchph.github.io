# `interpretation/` — P3 Interpretation & Tagging

Converts heterogeneous `CleanedSource` records (from P2 extraction) and uploaded
documents into a normalized `IndustryClassification` plus a compact `UserProfile`.
The key design principle is **fan-out then reconcile**: every source is tagged
independently and in parallel, then a single AI normalization pass collapses
synonym industries and skills across the full corpus.

Only two classes ever call the LLM — `ProjectTagger` (one call per source) and
`GlobalNormalizer` (one call per full run). Everything else is deterministic.

## Pipeline

```mermaid
flowchart TD
    P[projects: list[CleanedSource]] --> RM
    D[documents: list[RawDocument]] --> RM
    Po[posts: list[RetrievedSource]] --> RM
    RM[RetrievalMiddleman.gather] --> RS[list[RetrievedSource]]
    RS --> PTR[ParallelTagRunner.run<br/>ThreadPoolExecutor × max_workers<br/>bounded retry × max_retries]
    PTR -->|per source| PT[ProjectTagger.tag<br/>LLM structured call]
    PT --> TP[list[TaggedProject]]
    PTR --> RPT[TagRunReport<br/>sent / returned / failed / elapsed_s]
    TP --> CT[compile_tags<br/>concatenate result lists]
    CT --> GN[GlobalNormalizer.normalize<br/>LLM alias-map call<br/>deterministic fallback]
    GN --> IC[IndustryClassification]
    IC --> BUP[build_user_profile]
    BUP --> UP[UserProfile<br/>skills + industries only]
    IC --> PS[ProfileSink.save → user_profile.json]
```

## Files

| File | Role |
|---|---|
| `models.py` | `RetrievedSource`, `TagRunReport`, `UserProfile` pydantic models |
| `middleman.py` | `RetrievalMiddleman` — normalizes all source types into `RetrievedSource` envelopes |
| `tagger.py` | `ProjectTagger` — single-source LLM call → `TaggedProject`; raises on failure |
| `runner.py` | `ParallelTagRunner` — fan-out, bounded retry, `TagRunReport` reconciliation/KPI |
| `compiler.py` | `compile_tags` — concatenates per-source result lists (no merge/dedup) |
| `normalizer.py` | `GlobalNormalizer` — one AI alias-map pass + deterministic fallback |
| `profile.py` | `build_user_profile` + `ProfileSink` (persists to `user_profile.json`) |
| `__init__.py` | `interpret()` — single public orchestrator for the full P3 engine |

## Contracts / key signatures

```python
# models.py
class RetrievedSource(BaseModel):
    source_id: str
    kind: str          # "project" | "post" | "document"
    title: str = ""
    text: str = ""
    origin: str = ""   # "github" | "facebook" | "website" | "upload" ...

class TagRunReport(BaseModel):
    sent: int; returned: int; failed: int
    failures: list[str]   # source_ids that never returned
    elapsed_s: float
    success_rate: float   # property: returned / sent

class UserProfile(BaseModel):
    skills: list[str]
    industries: list[str]

# middleman.py
class RetrievalMiddleman:
    def gather(self, projects: list[CleanedSource] | None,
               documents: list[RawDocument] | None,
               posts: list[RetrievedSource] | None) -> list[RetrievedSource]: ...

# tagger.py
class ProjectTagger:
    def __init__(self, llm: LLMProvider) -> None: ...
    def tag(self, source: RetrievedSource) -> TaggedProject: ...  # raises on failure

# runner.py
class ParallelTagRunner:
    def __init__(self, tagger, max_workers: int = 6, max_retries: int = 1) -> None: ...
    def run(self, sources: list[RetrievedSource]) -> tuple[list[TaggedProject], TagRunReport]: ...

# compiler.py
def compile_tags(*result_lists: list[TaggedProject]) -> list[TaggedProject]: ...

# normalizer.py
class GlobalNormalizer:
    def __init__(self, llm: LLMProvider) -> None: ...
    def normalize(self, projects: list[TaggedProject]) -> IndustryClassification: ...

# profile.py
def build_user_profile(classification: IndustryClassification) -> UserProfile: ...
class ProfileSink:
    def __init__(self, out_dir: Path) -> None: ...
    def save(self, profile: UserProfile) -> Path: ...

# __init__.py
def interpret(
    llm: LLMProvider,
    projects=None, documents=None, posts=None,
    *, max_workers: int = 6, max_retries: int = 1,
) -> tuple[IndustryClassification, TagRunReport, UserProfile]: ...
```

## LLM boundary

| Class | LLM call | What it asks |
|---|---|---|
| `ProjectTagger` | Yes — once per source | Industry tags, skill_subtags, summary, quantitative/qualitative impact |
| `GlobalNormalizer` | Yes — once per run | `industry_map` + `skill_map` aliases (synonym → canonical) |
| All other classes | No | Deterministic |

## Reconciliation and KPI

`ParallelTagRunner` tracks every source dispatched (`sent`) vs every `TaggedProject` returned
(`returned`). Per-source failures are caught, retried up to `max_retries` times, and logged.
Any source that still fails appears in `TagRunReport.failures` and contributes to `failed`.
The run itself never raises, so a partial result set is always returned.

`GlobalNormalizer` falls back to a no-op alias map if the LLM call fails, so normalization
degrades gracefully to the raw per-source tags rather than crashing the run.

## How it fits

`interpretation/` sits between P2 (`extraction/`) and P4 assembly (`synthesizers/`, `classification/industry.py`).
It consumes `CleanedSource` and `RawDocument`, produces `IndustryClassification` (the structured
tag corpus for P4) and `UserProfile` (the flat skills+industries snapshot for downstream use).
`ProfileSink` persists the profile alongside the build output so it survives across runs.
