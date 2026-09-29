from __future__ import annotations

from ..classification.industry import TaggedProject


def compile_tags(*result_lists: list[TaggedProject]) -> list[TaggedProject]:
    """Concatenate per-source tagging results into one list. No merging/dedup here."""
    out: list[TaggedProject] = []
    for lst in result_lists:
        for item in lst or []:
            if item is not None:
                out.append(item)
    return out
