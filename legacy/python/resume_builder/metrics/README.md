# `metrics/` — Project Impact Metrics

Grounds the resume synthesizer in real, candidate-supplied numbers. The workflow
is heuristic mining → human confirmation → CSV persistence → synthesizer injection.
`AISynthesizer` reads the confirmed metrics and builds bullets around them; a project
with no metrics gets a qualitative bullet instead of an invented number.

The CSV is the source of truth. It is intentionally small and human-editable —
candidates can hand-add, correct, or delete rows between runs.

## Flow

```mermaid
flowchart TD
    R[Repo description + README] --> MR[mine_repo → MetricCandidate list]
    MR -->|regex patterns| RC[candidates<br/>% · Nx · unit-bearing · scaled numbers]
    RC --> HC{human confirms / edits / skips}
    HC -->|confirmed| PM[ProjectMetric list]
    PM --> SM[save_metrics → metrics.csv]
    SM --> LM[load_metrics on next run]
    LM --> MBR[metrics_by_repo<br/>dict str → list[ProjectMetric]]
    MBR --> SY[AISynthesizer<br/>injects as_fact strings into bullet prompts]
```

## Files

| File | Role |
|---|---|
| `models.py` | `ProjectMetric` pydantic model + `CSV_COLUMNS` constant + `as_fact()` formatter |
| `miner.py` | `mine_repo` / `mine_text` — regex heuristic extraction → `MetricCandidate` list |
| `store.py` | `load_metrics`, `save_metrics`, `metrics_by_repo`, `merge_metrics` — CSV persistence |

## Contracts / key signatures

```python
# models.py
CSV_COLUMNS = ["repo", "metric_label", "value", "context"]

class ProjectMetric(BaseModel):
    repo: str           # repo name or full_name
    metric_label: str   # e.g. "rows generated"
    value: str          # kept as text to preserve units: "2.1M chunks", "40%"
    context: str = ""   # optional qualifier: "vs baseline", "synthetic"
    def as_fact(self) -> str: ...   # "rows generated: 2.1M chunks (synthetic)"

# miner.py
@dataclass(frozen=True)
class MetricCandidate:
    repo: str; metric_label: str; value: str; context: str
    source: str        # "readme" | "description"
    confidence: str    # "high" | "low"

def mine_text(repo: str, text: str, source: str = "readme") -> list[MetricCandidate]: ...
def mine_repo(repo: Repo) -> list[MetricCandidate]: ...

# store.py
def load_metrics(path: str | Path) -> list[ProjectMetric]: ...     # [] if file absent
def save_metrics(path: str | Path, metrics: list[ProjectMetric]) -> Path: ...
def metrics_by_repo(metrics: list[ProjectMetric]) -> dict[str, list[ProjectMetric]]: ...
def merge_metrics(existing: list[ProjectMetric],
                  incoming: list[ProjectMetric]) -> list[ProjectMetric]: ...
```

## Mining confidence levels

| Pattern | Regex | Confidence |
|---|---|---|
| Percentages | `\d[\d,]*(?:\.\d+)?\s?%` | high |
| Multipliers | `\d[\d,]*(?:\.\d+)?\s?[x×]` | high |
| Number + strong unit | `2.1M chunks`, `8 500 rows`, `1.2k users` | high |
| Bare scaled number | `2.1M`, `8.5B` (no unit) | low |

Strong units: `rows records users requests queries docs images samples tokens embeddings
chunks params epochs downloads stars commits tests lines req/s qps rps fps`.

## Rules

- **Nothing in `miner.py` is authoritative.** Candidates are proposals; the human
  must confirm before they reach the CSV. Precision is traded for recall intentionally.
- `save_metrics` sorts by `(repo, metric_label, value)` for stable diffs.
- `load_metrics` skips rows missing `repo`, `metric_label`, or `value`; it never raises
  on a malformed CSV.
- `merge_metrics` de-duplicates on `(repo, metric_label, value)` (case-insensitive);
  incoming wins on `context` so a re-run can refine the qualifier without creating
  a duplicate row.
- `AISynthesizer` calls `metrics_by_repo` and injects each project's `as_fact()` strings
  as grounding facts into its bullet-writing prompt. No number in a final bullet should
  exist without a corresponding `ProjectMetric` row.
