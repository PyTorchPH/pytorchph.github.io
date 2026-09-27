from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from ..classification.industry import TaggedProject
from .models import RetrievedSource, TagRunReport

log = logging.getLogger(__name__)


class ParallelTagRunner:
    """Fan sources out to the tagger concurrently; reconcile sent-vs-returned with bounded retry."""

    def __init__(self, tagger, max_workers: int = 6, max_retries: int = 1) -> None:
        self._tagger = tagger
        self._max_workers = max(1, max_workers)
        self._max_retries = max(0, max_retries)

    def _tag_with_retry(self, source: RetrievedSource) -> TaggedProject | None:
        for attempt in range(self._max_retries + 1):
            try:
                return self._tagger.tag(source)
            except Exception as exc:  # noqa: BLE001 — retry, then give up (reported, not raised)
                log.warning("tag failed for %s (attempt %d): %s", source.source_id, attempt + 1, exc)
        return None

    def run(self, sources: list[RetrievedSource]) -> tuple[list[TaggedProject], TagRunReport]:
        start = time.monotonic()
        results: list[TaggedProject] = []
        failures: list[str] = []
        if not sources:
            return results, TagRunReport()
        with ThreadPoolExecutor(max_workers=self._max_workers) as pool:
            futures = {pool.submit(self._tag_with_retry, s): s for s in sources}
            for fut in as_completed(futures):
                source = futures[fut]
                try:
                    tagged = fut.result()
                except Exception as exc:  # noqa: BLE001 — collection must never raise
                    log.error("unexpected error collecting result for %s: %s", source.source_id, exc)
                    tagged = None
                if tagged is None:
                    failures.append(source.source_id)
                else:
                    results.append(tagged)
        report = TagRunReport(
            sent=len(sources),
            returned=len(results),
            failed=len(failures),
            failures=failures,
            elapsed_s=time.monotonic() - start,
        )
        return results, report
