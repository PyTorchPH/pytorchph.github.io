# P3 — Interpretation & Tagging (Design)

> **Status:** APPROVED (design) — 2026-06-30. Awaiting written-spec review before planning.
> **Owner:** PyTorch Philippines Student Chapter
> **Sub-spec of:** the industry-first, project-based resume-generation system (see _Parent decomposition_).
> **Board:** maps to GitHub Project #11 items **P1.8** (AI extraction pipeline: clean → dedup → classify → tag) and **P1.9** (skill/experience/industry extraction into normalized tables).

---

## 0. Where P3 sits

| # | Pipeline | Status |
|---|----------|--------|
| P1 | Collection | partial (GitHub via `gh`; social agent separate) |
| P2 | Website-Agnostic Extraction → `CleanedSource` | **shipped** (incl. 3-way scan depth `readme`/`markdown`/`code`) |
| **P3** | **Interpretation & Tagging** *(this spec)* | design approved |
| P4 | Industry Planning & Assembly | future |
| P5 | Bleed-Proof Render | future |
| S | Profile Storage (skills + industry tags) | future |

P3 turns retrieved, cleaned sources into **industry-tagged, skill-subtagged** project/post/document
records plus a **normalized global industry + skill set**, ready for P4 assembly.

## 1. Purpose

Classify and tag every piece of candidate evidence by **industry** (free-form, AI-discovered names),
attach **skill subtags**, separate **quantitative vs qualitative** impact, and produce
**component-level** bullets — then **dedup/normalize** industries and skills across the whole set so
P4 can build one resume per real industry. Project-based: an industry with no tagged source produces
no resume (no empty resumes).

Non-goals: P3 does not fetch/clean sources (that is P1/P2), does not assemble or render resumes
(P4/P5), and does not store to the DB (cross-cutting S).

## 2. Retrieval middleman (single entry for ALL sources)

The compile/retrieval layer is the **one middleman** that gathers every source into a common typed
envelope, so everything downstream depends on the envelope, not each source's quirks.

| Source kind | Origin | Notes |
|---|---|---|
| `project` | GitHub repos via P2 `gather_repo_sources(full_name, gh_json, depth=...)` | depth `readme`/`markdown`/`code`, user-selected per model capability |
| `post` | social posts (Profile Scraper Agent) + arbitrary websites (P2 skeleton pass) | own-authored / cleaned text only |
| `document` | **user-uploaded PDF/DOCX/TXT** | **text-based → NO OCR**; direct text via existing `DocumentSource` (pypdf / python-docx). A UI "PDF upload" control feeds these in |

Envelope (common shape entering tagging):

```python
class RetrievedSource(BaseModel):
    source_id: str            # repo full_name / url / document filename
    kind: str                 # "project" | "post" | "document"
    title: str = ""
    text: str = ""            # cleaned, token-lean (P2 CleanedSource.text, post text, or doc text)
    origin: str = ""          # "github" | "facebook" | "website" | "upload" ...
```

`document` sources are **dual-use**: they fan out to tagging (below) AND their raw extracted text
stays available to P4 synth for candidate context (contact / experience / education).

## 3. Parallel per-source tagging (fan-out)

Every `RetrievedSource` — `project`, `post`, AND `document` alike — gets **its own tagging agent**,
run in parallel. No single giant prompt; each agent sees only its one source.

- Each agent emits one **`TaggedProject`** (reusing `resume_builder.industry.TaggedProject`):
  `repo_full_name`/source_id, `industries[]` (free-form names; **multi-industry allowed** when the
  source genuinely spans them), `skill_subtags[]`, `summary`, `quantitative_impact[]`,
  `qualitative_impact[]`, and **component-level bullets**.
- **Tags are industry names, never skills.** Skills live only in `skill_subtags`.
- **Multi-industry:** a web app with security features → web **and** cybersecurity; with automation
  → devops too. Judge by what the source actually is, not just its languages.
- **Bullets policy:** `quantitative_impact` is rendered **first**, `qualitative_impact` /
  component-level bullets **last**. Never invent numbers — quantitative entries come only from the
  source text.

```
RetrievalMiddleman.gather() ──> [RetrievedSource, ...]
        │  (fan-out, parallel, one agent per source)
        ▼
ParallelTagRunner ── ProjectTagger(source) ──> TaggedProject     (×N concurrent)
        │  reconciliation/KPI: sent vs returned, bounded retry
        ▼
TagCompiler.compile([...]) ──> concatenated list (NO merging yet)
        ▼
GlobalNormalizer ── one AI pass ──> normalized industries + skills, tags rewritten to canonical
        ▼
IndustryClassification  ──> P4
```

## 4. Reconciliation / KPI checker

`ParallelTagRunner` owns dispatch and never silently drops a source.

- Track **dispatched vs returned** per source (a `sent / returned / failed` counter).
- **Retry detection:** the gap (sent − returned) names exactly which sources timed out / errored /
  dropped; re-request only those, with a **bounded retry count**; report any that still fail.
- **Developer KPI report:** `sent / returned / failed`, success rate, and per-source timing, so the
  parallel fan-out's throughput and reliability are visible.
- An unreturned source is a **tracked miss**, not a success.

## 5. Compile (concatenate, not aggregate)

Once the parallel agents return, `TagCompiler` simply **concatenates** the per-source `TaggedProject`s
into one list — no cross-source merging, summarization, or dedup at this step. Keeping each source's
result intact makes the set easy to parse and hands a clean, complete input to normalization.

## 6. Global normalization pass (dedup of industries AND skills)

Because each parallel agent is blind to the other sources, industry names and skills drift
("AI" vs "artificial intelligence", "JS" vs "JavaScript"). One **AI normalization pass** over the
whole compiled set fixes this:

- Merge/canonicalize **industry names** AND **skill subtags** into single canonical labels, guided by
  a system prompt that explicitly avoids overlapping/duplicate labels.
- Rewrite every `TaggedProject`'s `industries` + `skill_subtags` to the canonical names.
- Output the de-duplicated `normalized_industries` + normalized skill vocabulary.
- **Fallback:** if the AI pass fails, fall back to a deterministic lowercase-merge (case/whitespace
  canonicalization) so the pipeline still produces a usable, never-raising result.

Output is an `IndustryClassification` (reuse `resume_builder.industry.IndustryClassification`):
`normalized_industries`, tagged `projects` (canonical industries + skills + quant/qual + bullets), and
`achievements` surfaced from posts/documents — consumed directly by P4's `plan_industry_resumes`.

## 7. Components (small, isolated units)

| Unit | Responsibility | Depends on |
|---|---|---|
| `RetrievedSource` | common source envelope | pydantic |
| `RetrievalMiddleman` | gather project/post/document sources → envelopes; route | P2 `gather_repo_sources`, `DocumentSource`, social agent |
| `ProjectTagger` | tag ONE source → `TaggedProject` | LLM provider, `TaggedProject` |
| `ParallelTagRunner` | fan-out, concurrency, reconciliation/KPI, bounded retry | `ProjectTagger` |
| `TagCompiler` | concatenate per-source results | — |
| `GlobalNormalizer` | one AI pass merging industries + skills; deterministic fallback | LLM provider, `IndustryClassification` |

The only AI-touching units are `ProjectTagger` and `GlobalNormalizer`, both behind the `LLMProvider`
ABC so they are mockable in tests.

## 8. Error handling

- **Per-source isolation** — one source's tagging failure never breaks the batch; it is retried
  (bounded) then reported as failed via the KPI counter.
- **Never silently drop** — unreturned sources are tracked misses surfaced in the report.
- **Normalization fallback** — AI normalization failure degrades to deterministic lowercase-merge.
- **No invented numbers** — quantitative bullets only from source text.

## 9. Testing

- **Per-source tagging** — a fixture source + mocked LLM → assert `TaggedProject` shape, multi-industry
  tagging, quant/qual separation.
- **Parallel + reconciliation** — N sources where some "fail" → assert retry of only the missing ones,
  correct `sent/returned/failed` counts, no silent drop.
- **Compile** — concatenation preserves every source's result (no merge).
- **Global normalization** — a compiled set with `AI`/`artificial intelligence` and `JS`/`JavaScript`
  → assert single canonical labels and rewritten project tags; AI-failure path falls back
  deterministically.
- **Document fan-out** — an uploaded text-based PDF (no OCR) is tagged like any source AND its raw text
  remains available for P4 context.

## 10. Reuses (do not reinvent)

- `TaggedProject`, `TaggedAchievement`, `IndustryClassification`, `_normalize_classification` —
  `backend/legacy-python/resume_builder/industry.py`.
- `DocumentSource` (pypdf / python-docx, no OCR) — `backend/legacy-python/resume_builder/sources/document.py`.
- `gather_repo_sources` / `CleanedSource` — `backend/legacy-python/resume_builder/extraction/` (P2).
- `LLMProvider` ABC — `backend/legacy-python/resume_builder/llm/base.py`.

## 11. Open / deferred

- Concurrency cap for the parallel runner (tune against API rate limits).
- Bounded-retry count + backoff defaults.
- Whether `post`/`document` tagging emits `TaggedProject` or a lighter `TaggedAchievement` for
  non-project sources (lean toward `TaggedProject` for uniformity; revisit in planning).
- UI "PDF upload / scanner" control is a UI-layer task (separate from this engine spec).
- Exact KPI report surface (log line vs structured object) — decide in planning.
