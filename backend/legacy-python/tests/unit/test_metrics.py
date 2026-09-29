"""Unit tests for the project-metrics store and miner."""

from __future__ import annotations

from resume_builder.metrics import (
    ProjectMetric,
    load_metrics,
    merge_metrics,
    metrics_by_repo,
    mine_text,
    save_metrics,
)
from resume_builder.metrics.miner import mine_repo
from resume_builder.core.models import Repo


# ---- store ----

def test_store_roundtrip_preserves_metrics(tmp_path):
    path = tmp_path / "metrics.csv"
    metrics = [
        ProjectMetric(repo="rag-bot", metric_label="docs indexed", value="2.1M chunks", context="wiki"),
        ProjectMetric(repo="data-gen", metric_label="rows generated", value="8.5M", context="synthetic"),
    ]
    save_metrics(path, metrics)
    loaded = load_metrics(path)
    assert {(m.repo, m.metric_label, m.value, m.context) for m in loaded} == {
        ("rag-bot", "docs indexed", "2.1M chunks", "wiki"),
        ("data-gen", "rows generated", "8.5M", "synthetic"),
    }


def test_load_missing_file_returns_empty(tmp_path):
    assert load_metrics(tmp_path / "nope.csv") == []


def test_load_skips_rows_without_value(tmp_path):
    path = tmp_path / "metrics.csv"
    path.write_text(
        "repo,metric_label,value,context\n"
        "rag-bot,docs,,\n"          # no value -> skipped
        ",label,5M,\n"               # no repo  -> skipped
        "good,users,1.2k/mo,prod\n",
        encoding="utf-8",
    )
    loaded = load_metrics(path)
    assert len(loaded) == 1
    assert loaded[0].repo == "good" and loaded[0].value == "1.2k/mo"


def test_group_by_repo():
    metrics = [
        ProjectMetric(repo="a", metric_label="x", value="1"),
        ProjectMetric(repo="a", metric_label="y", value="2"),
        ProjectMetric(repo="b", metric_label="z", value="3"),
    ]
    grouped = metrics_by_repo(metrics)
    assert len(grouped["a"]) == 2 and len(grouped["b"]) == 1


def test_merge_dedupes_on_repo_label_value():
    existing = [ProjectMetric(repo="a", metric_label="rows", value="5M", context="old")]
    incoming = [
        ProjectMetric(repo="a", metric_label="rows", value="5M", context="new"),  # dup key
        ProjectMetric(repo="a", metric_label="users", value="1k", context=""),    # new
    ]
    merged = merge_metrics(existing, incoming)
    assert len(merged) == 2
    rows = next(m for m in merged if m.metric_label == "rows")
    assert rows.context == "new"  # incoming wins


def test_as_fact_includes_context():
    m = ProjectMetric(repo="a", metric_label="latency", value="40% faster", context="p99")
    assert m.as_fact() == "latency: 40% faster (p99)"


# ---- miner ----

def test_mine_percent_and_multiplier_are_high_confidence():
    text = "Reduced latency by 40% and improved throughput 3x."
    cands = mine_text("proj", text)
    values = {c.value for c in cands}
    assert "40%" in values
    assert any(v.lower() == "3x" for v in values)
    assert all(c.confidence == "high" for c in cands if c.value in {"40%", "3x"})


def test_mine_number_with_strong_unit():
    text = "Indexed 2.1M chunks across the corpus."
    cands = mine_text("proj", text)
    hit = next(c for c in cands if "chunk" in c.metric_label)
    assert "2.1M chunks".lower() in hit.value.lower()
    assert hit.confidence == "high"


def test_mine_bare_scaled_number_is_low_confidence():
    text = "Processed 8.5M overnight."
    cands = mine_text("proj", text)
    scaled = next(c for c in cands if c.value.lower().startswith("8.5m"))
    assert scaled.confidence == "low"


def test_mine_text_without_numbers_returns_empty():
    assert mine_text("proj", "A clean command-line tool with no numbers.") == []


def test_mine_repo_uses_readme_and_description():
    repo = Repo(
        name="rag-bot",
        full_name="me/rag-bot",
        url="https://github.com/me/rag-bot",
        description="Serves 1.2k users/mo.",
        readme="Indexed 2.1M chunks. Improved recall 3x.",
    )
    cands = mine_repo(repo)
    values = {c.value.lower() for c in cands}
    assert any("1.2k users" in v for v in values)
    assert any("2.1m chunks" in v for v in values)
    assert any(v == "3x" for v in values)
