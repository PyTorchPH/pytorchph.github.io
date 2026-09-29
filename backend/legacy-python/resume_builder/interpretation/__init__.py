"""P3 — interpretation & tagging package."""
from __future__ import annotations

from ..classification.industry import IndustryClassification
from ..llm.base import LLMProvider
from .compiler import compile_tags
from .middleman import RetrievalMiddleman
from .models import RetrievedSource, TagRunReport, UserProfile
from .normalizer import GlobalNormalizer
from .profile import ProfileSink, build_user_profile
from .runner import ParallelTagRunner
from .tagger import ProjectTagger

__all__ = [
    "RetrievedSource", "TagRunReport", "UserProfile",
    "RetrievalMiddleman", "ProjectTagger", "ParallelTagRunner",
    "compile_tags", "GlobalNormalizer", "ProfileSink", "build_user_profile",
    "interpret",
]


def interpret(
    llm: LLMProvider,
    projects=None,
    documents=None,
    posts=None,
    *,
    max_workers: int = 6,
    max_retries: int = 1,
) -> tuple[IndustryClassification, TagRunReport, UserProfile]:
    """Run the full P3 engine: gather -> parallel tag -> compile -> normalize -> profile."""
    sources = RetrievalMiddleman().gather(projects=projects, documents=documents, posts=posts)
    runner = ParallelTagRunner(ProjectTagger(llm), max_workers=max_workers, max_retries=max_retries)
    tagged, report = runner.run(sources)
    compiled = compile_tags(tagged)
    classification = GlobalNormalizer(llm).normalize(compiled)
    profile = build_user_profile(classification)
    return classification, report, profile
