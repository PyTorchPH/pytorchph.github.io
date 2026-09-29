from __future__ import annotations

from pydantic import BaseModel, Field

from ..classification.industry import IndustryClassification, TaggedProject, _dedupe, _normalize_classification
from ..llm.base import LLMProvider

_NORMALIZER_SYSTEM = (
    "You merge overlapping INDUSTRY names and SKILL names into single canonical labels for an "
    "industry-first resume system. Return two maps: industry_map and skill_map, each mapping a "
    "variant (lowercased) to its canonical label. Merge synonyms ('ai'→'artificial intelligence', "
    "'js'→'JavaScript', 'next.js'→'Next.js'). Avoid overlapping/duplicate canonical labels. Only "
    "include entries that actually need merging; be concise."
)


class _AliasMap(BaseModel):
    industry_map: dict[str, str] = Field(default_factory=dict)
    skill_map: dict[str, str] = Field(default_factory=dict)


def _apply(value: str, amap: dict[str, str]) -> str:
    return amap.get(value.strip().lower(), value.strip())


class GlobalNormalizer:
    """One AI pass merges industries + skills across all projects; deterministic fallback."""

    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    def _alias_map(self, projects: list[TaggedProject]) -> _AliasMap:
        industries = _dedupe(i for p in projects for i in p.industries)
        skills = _dedupe(s for p in projects for s in p.skill_subtags)
        prompt = (
            f"Industries seen: {industries}\nSkills seen: {skills}\n\n"
            "Return industry_map and skill_map (variant_lowercased -> canonical)."
        )
        try:
            return self._llm.structured(
                prompt, schema=_AliasMap, system=_NORMALIZER_SYSTEM, max_tokens=1024
            )
        except Exception:  # noqa: BLE001 — fall back to a deterministic lowercase/dedup merge
            return _AliasMap()

    def normalize(self, projects: list[TaggedProject]) -> IndustryClassification:
        amap = self._alias_map(projects)
        industry_map = {k.strip().lower(): v for k, v in amap.industry_map.items()}
        skill_map = {k.strip().lower(): v for k, v in amap.skill_map.items()}
        rewritten: list[TaggedProject] = []
        for p in projects:
            rewritten.append(
                p.model_copy(
                    update={
                        "industries": _dedupe(
                            _apply(i, industry_map) for i in p.industries
                        ),
                        "skill_subtags": _dedupe(_apply(s, skill_map) for s in p.skill_subtags),
                    }
                )
            )
        result = IndustryClassification(
            normalized_industries=_dedupe(i for p in rewritten for i in p.industries),
            projects=rewritten,
        )
        # reuse the existing canonicaliser (lowercases industry tags, dedups) for a clean fallback
        return _normalize_classification(result)
