"""Locks in the measured benchmark data and the complexity model.

These tests are deterministic and offline: they assert on data/measured.json
(captured against live pages once) and on the cost model in benchmark.py. They
exist so the agent-vs-pipeline complexity claims cannot silently rot.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

_BENCH = Path(__file__).resolve().parents[2] / "tests" / "benchmarks" / "scraper_token_cost" / "benchmark.py"
_spec = importlib.util.spec_from_file_location("scraper_benchmark", _BENCH)
benchmark = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(benchmark)

DATA = benchmark.load_measured()


def test_measured_data_matches_what_was_observed():
    pages = DATA["measured"]["pages"]
    assert [p["raw_html_chars"] for p in pages] == [11021, 13699, 9987, 10283, 9970]
    # strict class-vocabulary fingerprint split the 5 pages into exactly 2 layouts
    assert DATA["measured"]["distinct_fingerprints"] == 2
    assert sum(1 for p in pages if p["cache_hit"]) == 3  # pages 3,4,5 reuse page 2's rules


def test_agent_naive_is_quadratic():
    # doubling N roughly quadruples cost when context accumulates (O(N^2))
    t_n = benchmark.agent_tokens(50, DATA, mode="naive")
    t_2n = benchmark.agent_tokens(100, DATA, mode="naive")
    assert 3.6 < t_2n / t_n < 4.4


def test_agent_best_is_linear():
    # with per-page isolation, doubling N roughly doubles cost (O(N))
    t_n = benchmark.agent_tokens(50, DATA, mode="best")
    t_2n = benchmark.agent_tokens(100, DATA, mode="best")
    assert 1.9 < t_2n / t_n < 2.1


def test_pipeline_is_linear_with_a_much_smaller_slope():
    data = DATA
    # pipeline slope per page = link-selection only (rule-learning is amortized away)
    slope_pipe = benchmark.pipeline_tokens(101, data) - benchmark.pipeline_tokens(100, data)
    slope_agent_best = benchmark.agent_tokens(101, data, mode="best") - benchmark.agent_tokens(
        100, data, mode="best"
    )
    # agent's per-page cost is at least 8x the pipeline's per-page cost
    assert slope_agent_best > 8 * slope_pipe


def test_pipeline_wins_at_scale_under_both_agent_models():
    data = DATA
    pipe = benchmark.pipeline_tokens(100, data)
    assert pipe < benchmark.agent_tokens(100, data, mode="best")
    assert pipe < benchmark.agent_tokens(100, data, mode="naive")


def test_crossover_is_a_handful_of_pages():
    co = benchmark.crossover_pages(DATA)
    assert co is not None and 3 <= co <= 8
