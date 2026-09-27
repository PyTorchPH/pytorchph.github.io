from __future__ import annotations

from ..classification.industry import TaggedProject
from ..llm.base import LLMProvider
from ..core.principles import HARVARD_PRINCIPLES
from .models import RetrievedSource

_TAGGER_SYSTEM = (
    "TASK: tag ONE candidate source for an industry-first resume. OUTPUT: structured JSON only.\n"
    "industries: industry/domain names; never skills; multiple only when real components prove them.\n"
    "skill_subtags: atomic/canonical skills for matching; e.g. JavaScript, ReactJS, React Native, Vue.\n"
    "results.quantitative: sourced numbers only; metric + value; context/meaning = next short item; "
    "never invent/estimate/alter/extrapolate.\n"
    "results.qualitative: concrete non-numeric outcome; effect/beneficiary/technical context = next "
    "short item when supported.\n"
    "conclusion: 1 plain-language takeaway; value created + strongest demonstrated capability.\n"
    "STYLE: preserve a good existing sentence; add context as a separate short sentence/item; "
    "dumbed-down clarity; compact clauses/lists; prefer : - , (); omit filler.\n\n"
) + HARVARD_PRINCIPLES


class ProjectTagger:
    """Tags a single RetrievedSource into a TaggedProject. Raises on LLM/parse failure —
    ParallelTagRunner owns per-source isolation (bounded retry + tracked miss)."""

    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    def tag(self, source: RetrievedSource) -> TaggedProject:
        prompt = (
            f"Source id: {source.source_id}\nKind: {source.kind}\nTitle: {source.title}\n\n"
            f"Content:\n{source.text}\n\n"
            "Return: industries, skill_subtags, summary, results{quantitative,qualitative}, conclusion."
        )
        tagged = self._llm.structured(
            prompt, schema=TaggedProject, system=_TAGGER_SYSTEM, max_tokens=2048
        )
        tagged.repo_full_name = source.source_id
        return tagged
