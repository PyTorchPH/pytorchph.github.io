# P2 / P3 follow-up notes (user feedback, 2026-06-30)

Captured mid-build so they are not lost. These refine the already-merged P2 and shape the
not-yet-built P3 (Interpretation & Tagging). Not implemented yet — inputs for the next plan.

## 0. P3 → P4 integration gaps (KNOWN, from the P3 whole-branch review — fix before wiring)

The P3 `interpretation` engine is merged and standalone-correct, but wiring it into `pipeline.py`
(`run_industry_auto`/`plan_industry_resumes`) is deferred. Two contract mismatches MUST be resolved
at wiring time or P3→P4 silently produces empty/duplicated output:

1. **`repo_full_name` key mismatch.** P2 emits `CleanedSource.source_id = "owner/repo:README.md"`;
   `ProjectTagger` forces `repo_full_name = source_id`, so it carries the `:path` suffix. But P4's
   `plan_industry_resumes` does `repos_by_full_name.get(tagged.repo_full_name)` keyed on the **bare**
   `owner/repo` → every P3 project would miss the lookup and be dropped. Fix at wiring: carry the bare
   repo full_name into the tag (split on `:`), AND collapse the **multiple `CleanedSource`s per repo**
   (readme/markdown/code each become a TaggedProject) into one project per repo (a per-repo merge step)
   so P4 does not emit duplicate `ResumeProject`s.
2. **Non-GitHub sources dropped by P4.** Posts/documents are tagged with `repo_full_name = "fb:1"` /
   `"cv.pdf"`; P4's repo-keyed lookup returns `None` for these → dropped. At wiring, route post/document
   tagged records to the achievements/context path (not the repo-project path) so their evidence
   surfaces, per spec §2/§6.

> These are the agreed "known integration gaps" — the engine merges as-is; resolve #1/#2 together with
> the runner/tagger seam (already fixed: tagger raises, runner tracks misses) when wiring P3 into the
> pipeline.

## 1. Scan depth becomes a USER-FACING 3-way option

The earlier P2 decision (README-only default + optional deep code) is refined into an explicit
**user-selectable** choice, picked according to the capability of the model the user supplies:

| Option | What gets fed to the model | For |
|---|---|---|
| `readme` (default, lightest) | the main/root README only | weak or no AI / smallest token budget |
| `markdown` | all markdown docs in the repo (README.* + docs/*.md) | mid capability |
| `code` | all relevant code too (broad source sweep) | strong models / richest context |

- **Why:** give importance to people who don't have much AI capability — the lightest option keeps
  token cost low and still works on small/free models. The heavier options are opt-in for stronger
  models.
- `collect_repo_markdown` already implements the `markdown` tier; `readme`-only is a trivial subset;
  the `code` tier is the deferred broad-source-sweep (`collect_repo_code`).
- Surface: a CLI flag / API param now (developer option); a real product UI toggle later.

## 2. P3 architecture — parallel per-project tagging agents

In the actual interpretation pipeline, do NOT send all projects to one big call. Instead:

- **One agent per project** — each agent summarizes its single project and emits that project's
  JSON (industries, skill_subtags, quantitative/qualitative impact, component-level bullets).
- **Run them in parallel** (fan-out) — independent, so wall-clock = slowest single project.
- **Compile, do NOT aggregate** — once all per-project JSONs return, simply concatenate/combine
  them into one structure the system can parse. No cross-project merging or summarization at this
  step; keep each project's result intact for easy downstream parsing.
- Benefit: scales to many repos, isolates context per project (cheaper/cleaner prompts), and avoids
  one giant prompt. Fits the per-source `CleanedSource` output of P2 one-to-one.
- **Request/response reconciliation checker.** Track how many per-project requests were **sent** vs how
  many **came back** (a dispatched-vs-returned counter). Two uses:
  - **Developer KPI reporting** — surface `sent / returned / failed`, success rate, and timing so devs
    can see throughput and reliability of the parallel fan-out.
  - **Retry detection** — the gap (sent minus returned) names exactly which projects did not respond
    (timeout / error / dropped); re-request only those, with a bounded retry count, then report any
    that still fail. Never silently drop a project — an unreturned request is a tracked miss, not a
    success.

## 3. Refactor + folder-structure segregation by functionality

- Refactor refactorable code into **functionally-segregated folders** — one folder per concept/theory.
- Model the segregation on the existing **botting folder** pattern: the whole idea/concept lives in a
  single self-contained folder. One-folder-per-concept is the target; a single cohesive folder is fine.
- Apply when touching code that has grown tangled; keep each concept's code together.

## 4. Compile pipeline = the retrieval MIDDLEMAN for ALL sources (+ PDF upload, no OCR)

Reframe the P3 "compile" step from "concatenate the per-project tagging JSONs" into the **single
middleman that gathers every retrieved input** and routes it. All retrieval flows through it.

- **Sources it gathers** (one typed envelope each):
  - `project` — GitHub repos via P2 `gather_repo_sources` (depth `readme`/`markdown`/`code`).
  - `post` — social posts (Profile Scraper Agent) and arbitrary websites (P2 skeleton pass).
  - `document` — **user-uploaded PDF/DOCX/TXT** from the UI. **Text-based → NO OCR**; extract text
    directly via the existing `DocumentSource` (pypdf / python-docx). A "PDF upload / scanner"
    control on the UI side feeds these in.
- **Routing after compile — ALL source types fan out to parallel tagging agents:**
  - `project` + `post` + `document` → each source (including each uploaded document) gets **its own
    parallel tagging agent** that summarizes it and emits tagged JSON (industries + skills +
    quant/qual + component bullets). Documents are a first-class taggable source, not passive context.
  - `document` ADDITIONALLY: its raw extracted text stays available to P4 synth for candidate
    context (contact / experience / education) — dual-use (tagged in P3 AND raw context in P4).
  - Reconciliation/KPI counts every dispatched source (projects + posts + documents) as sent-vs-returned.
- **Why middleman:** one place owns retrieval + normalization into a common shape, so tagging and
  assembly depend on the envelope, not on each source's quirks. Uploaded docs become a first-class
  source alongside GitHub and social — no special-casing downstream.

> Status: notes only. Fold #1 into a P2 follow-up task (scan-depth option + `collect_repo_code`,
> partly shipped 2026-06-30), and #2/#3/#4 into the P3 (Interpretation & Tagging) spec.
