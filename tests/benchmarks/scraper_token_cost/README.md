# Scraper token-cost benchmark — agent tool-calling vs `AgenticCrawler` pipeline

Quantifies how the two scraping strategies differ in **token cost** and **output shape**,
and — crucially — in **complexity as the page count `N` grows**.

## TL;DR

| Strategy | LLM token complexity | Output shape |
|---|---|---|
| Agent tool-calling (naive, accumulating context) | **O(N²)** — every prior page is re-read each turn | Structured per-field JSON `{text, author, tags[]}`, semantic, ready to use |
| Agent tool-calling (best case, per-page isolation) | **O(N)** — each page enters context once, but loses cross-page reasoning | same |
| `AgenticCrawler` pipeline | **O(N)** with a ~15× smaller slope **+ bounded O(L)** for `L` distinct layouts | Flat text-region blob; faithful corpus, needs a 2nd pass for structured fields |

Crossover ≈ **6 pages**. Below it the agent is cheaper (less fixed overhead). Above it the
pipeline wins and the gap widens because the agent is *super-linear* while the pipeline is not.

## What is actually MEASURED vs what is MODELED

Honesty matters here — the headline numbers are **partly measured, partly assumed**.

**Measured** (real fetches against live `quotes.toscrape.com` + the repo's real functions
`build_dom_inventory` / `fingerprint` / `apply_tag_rules`, tokenized with `tiktoken cl100k_base`):
- Raw HTML size of each page; DOM-inventory size; each page's fingerprint.
- That the strict class-vocabulary fingerprint splits pages 1–5 into **exactly 2 layouts**
  (page 1 has `li.next` only; pages 2–5 have `li.next` + `li.previous`), so pages 3–5 are **cache hits**.
- The actual extracted output of both strategies (50 structured records vs the flat text blob).
- The exact prompt-char/token sizes of the pipeline's rule-inference and link-selection calls.

**Assumed / modeled** (NOT measured against a live LLM — no real billing was observed; the
pipeline's rule-learning was role-played by an AI subagent):
- Agent one-time system prompt (600 tok) and per-page extraction output (400 tok).
- Pipeline rule/link output sizes.
- **All scaling projections (N = 25, 50, 100, 500) and the crossover** are *extrapolations*
  from the per-page slope, not observed crawls.

Every field in `data/measured.json` is tagged `measured` or `assumed` so you can audit it.

## Complexity derivation

Let `p` = avg tokens of one page's HTML (~2,856 here).

- **Agent, naive:** turn `k` re-reads pages `1..k`, so cumulative input
  `= p·(1+2+…+N) = p·N(N+1)/2` → **O(N²)**.
- **Agent, best:** each page read once `= p·N` → **O(N)** (only with disciplined context pruning,
  which throws away cross-page context).
- **Pipeline:** rule-learning is paid once per *distinct layout* `L` (not per page) → **O(L)**, `L`
  bounded and small; link-selection is one small bounded call per page → **O(N)** with a tiny
  constant; extraction is deterministic Python → **0 LLM tokens**.

Prompt caching softens the agent's re-reads but does not change the Θ(N²) tokens *processed*.

## Reproduce

```bash
# offline: projection + complexity model from the captured data
python tests/benchmarks/scraper_token_cost/benchmark.py

# offline: lock-in tests for the data and the model
python -m pytest tests/unit/test_scraper_token_benchmark.py -q
```

To re-measure against the live site (needs network + `tiktoken`), re-fetch the 5 pages and
re-run `build_dom_inventory` / `fingerprint` / `apply_tag_rules` from
`legacy/python/resume_builder/extraction/`, then update `data/measured.json`.

## Want hard, end-to-end token numbers?

This benchmark models LLM cost; it does not bill a real provider. For ground-truth token/cost
accounting, instrument `LLMProvider.structured` to log real input/output tokens per call and run
an actual multi-page crawl. Off-the-shelf tools that do this well:

- **Langfuse** (open-source) / **LangSmith** — per-call token + cost tracing, datasets, experiments.
- **Helicone** — drop-in proxy that logs tokens/cost per request.
- **promptfoo** — eval harness to compare outputs *and* cost across strategies.
- **Arize Phoenix** / **W&B Weave** — LLM tracing + evaluation with token accounting.

For web-*agent* task benchmarks (completion quality, not token cost): **WebArena**, **Mind2Web**,
**WebVoyager**, **GAIA**, **AgentBench**.
