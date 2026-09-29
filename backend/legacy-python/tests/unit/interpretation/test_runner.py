from __future__ import annotations

import threading

from resume_builder.classification.industry import TaggedProject
from resume_builder.interpretation.models import RetrievedSource
from resume_builder.interpretation.runner import ParallelTagRunner


class _CountingTagger:
    """Tagger stub: fails the first attempt for source 'flaky', succeeds on retry."""

    def __init__(self):
        self.seen = {}
        self.lock = threading.Lock()

    def tag(self, source):
        with self.lock:
            self.seen[source.source_id] = self.seen.get(source.source_id, 0) + 1
            attempt = self.seen[source.source_id]
        if source.source_id == "flaky" and attempt == 1:
            raise RuntimeError("transient")
        return TaggedProject(repo_full_name=source.source_id, industries=["ai"])


def _src(i):
    return RetrievedSource(source_id=i, kind="project", text="x")


def test_run_tags_all_sources_and_reports():
    runner = ParallelTagRunner(_CountingTagger(), max_workers=4, max_retries=1)
    results, report = runner.run([_src("a"), _src("b"), _src("flaky")])
    ids = {r.repo_full_name for r in results}
    assert ids == {"a", "b", "flaky"}            # flaky recovered on retry
    assert report.sent == 3 and report.returned == 3 and report.failed == 0


def test_run_reports_permanent_failure_without_dropping_silently():
    class _AlwaysFail:
        def tag(self, source):
            raise RuntimeError("dead")

    results, report = ParallelTagRunner(_AlwaysFail(), max_retries=1).run([_src("a"), _src("b")])
    assert results == []
    assert report.sent == 2 and report.returned == 0 and report.failed == 2
    assert set(report.failures) == {"a", "b"}


def test_run_empty_input():
    results, report = ParallelTagRunner(_CountingTagger()).run([])
    assert results == [] and report.sent == 0 and report.failed == 0


def test_runner_tracks_real_tagger_llm_failure():
    from resume_builder.interpretation.tagger import ProjectTagger

    class _BoomLLM:
        def structured(self, *a, **k):
            raise RuntimeError("llm down")

    runner = ParallelTagRunner(ProjectTagger(_BoomLLM()), max_retries=1)
    results, report = runner.run([_src("a"), _src("b")])
    assert results == [] and report.failed == 2 and set(report.failures) == {"a", "b"}
