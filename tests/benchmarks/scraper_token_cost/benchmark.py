"""Token-cost model: agent-tool-calling scraper vs the AgenticCrawler pipeline.

This encodes the complexity analysis as runnable code so the claims are auditable
instead of hand-waved. It does NOT call a live LLM; it combines empirically
measured page/inventory/fingerprint sizes (data/measured.json, captured against the
live quotes.toscrape.com pages and the repo's real functions) with the explicitly
labelled `assumed` constants to project token cost as the page count N grows.

Complexity, in one line each:
- Agent (naive, accumulating context): O(N^2) tokens  -- every prior page is re-read each turn.
- Agent (best case, per-page isolation):  O(N)   tokens  -- each page enters context once.
- Pipeline:                                O(N)   tokens with a ~15x smaller slope,
                                           plus a bounded O(L) term for L distinct layouts.

Run:  python tests/benchmarks/scraper_token_cost/benchmark.py
"""
from __future__ import annotations

import json
from pathlib import Path

_DATA = Path(__file__).parent / "data" / "measured.json"


def load_measured(path: Path = _DATA) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def agent_tokens(n_pages: int, data: dict, *, mode: str = "naive") -> float:
    """Agent-tool-calling token cost for crawling `n_pages`.

    mode='naive': context accumulates, so the input re-read grows quadratically
        (page k re-reads pages 1..k). Total input ~ p * N(N+1)/2  ->  O(N^2).
    mode='best':  each page enters context exactly once (full pruning/isolation).
        Total input ~ p * N  ->  O(N). Sacrifices cross-page reasoning.
    """
    p = data["derived_constants"]["avg_raw_html_tokens_per_page"]
    sys_once = data["assumed"]["agent_system_prompt_tokens"]
    out_per_page = data["assumed"]["agent_output_tokens_per_page"]
    if mode == "naive":
        input_tokens = p * n_pages * (n_pages + 1) / 2
    elif mode == "best":
        input_tokens = p * n_pages
    else:
        raise ValueError("mode must be 'naive' or 'best'")
    return sys_once + input_tokens + out_per_page * n_pages


def pipeline_tokens(n_pages: int, data: dict, *, distinct_layouts: int = 2) -> float:
    """AgenticCrawler token cost for crawling `n_pages`.

    Rule-learning is paid once per DISTINCT layout (fingerprint), not per page:
    O(L). Link-selection is one small bounded call per crawled page: O(N).
    Deterministic extraction (apply_tag_rules) costs ZERO LLM tokens.
    `distinct_layouts` is site-dependent and bounded; for quotes.toscrape it is 2
    regardless of how many pages are crawled (first page vs interior pages).
    """
    c = data["derived_constants"]
    a = data["assumed"]
    rule_in = c["avg_rule_inference_input_tokens_per_layout"]
    rule_out = a["pipeline_rule_output_tokens_per_layout"]
    link_in = c["link_selection_input_tokens_per_page"]
    link_out = a["pipeline_link_output_tokens_per_page"]
    layouts = min(distinct_layouts, n_pages)
    rule_cost = layouts * (rule_in + rule_out)            # O(L), bounded
    link_cost = n_pages * (link_in + link_out)            # O(N), small slope
    return rule_cost + link_cost


def crossover_pages(data: dict, *, distinct_layouts: int = 2, max_n: int = 10_000) -> int | None:
    """Smallest N where the pipeline becomes cheaper than the BEST-case agent."""
    for n in range(1, max_n + 1):
        if pipeline_tokens(n, data, distinct_layouts=distinct_layouts) < agent_tokens(
            n, data, mode="best"
        ):
            return n
    return None


def _fmt(x: float) -> str:
    return f"{x:,.0f}"


def main() -> None:
    data = load_measured()
    print("Token-cost projection: agent tool-calling vs AgenticCrawler pipeline")
    print(f"(tokenizer: {data['tokenizer']}; distinct layouts L=2 for quotes.toscrape)\n")
    header = f"{'pages':>6} | {'agent O(N^2) naive':>18} | {'agent O(N) best':>15} | {'pipeline O(N)':>13} | {'x vs best':>9}"
    print(header)
    print("-" * len(header))
    for n in (1, 5, 10, 25, 50, 100, 500):
        a_naive = agent_tokens(n, data, mode="naive")
        a_best = agent_tokens(n, data, mode="best")
        pipe = pipeline_tokens(n, data)
        ratio = a_best / pipe
        print(f"{n:>6} | {_fmt(a_naive):>18} | {_fmt(a_best):>15} | {_fmt(pipe):>13} | {ratio:>8.1f}x")
    co = crossover_pages(data)
    print(f"\nCrossover vs best-case agent: pipeline wins from N >= {co} pages.")
    print("Below that the agent is cheaper (lower fixed overhead); above it the")
    print("pipeline wins and the gap widens: agent is super-linear, pipeline is not.")


if __name__ == "__main__":
    main()
