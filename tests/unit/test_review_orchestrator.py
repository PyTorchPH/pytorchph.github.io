from __future__ import annotations

from resume_builder.llm.base import LLMProvider
from resume_builder.review.review_orchestrator import (
    MAX_RESUME_REVIEW_CHARS,
    REVIEW_SYSTEM_PROMPT,
    build_review_prompt,
    review_resume_text,
)


class _CapturingLLM(LLMProvider):
    name = "capturing"

    def __init__(self) -> None:
        self.last_prompt: str | None = None
        self.last_system: str | None = None
        self.last_max_tokens: int | None = None

    def complete(self, prompt, system=None, max_tokens=1024):
        self.last_prompt = prompt
        self.last_system = system
        self.last_max_tokens = max_tokens
        return "# Critical Issues\n- x"


def test_review_system_prompt_matches_findings_only_subagent_contract():
    assert "Resume Review Orchestrator" in REVIEW_SYSTEM_PROMPT
    assert "SUBAGENT A: STRUCTURE AUDITOR" in REVIEW_SYSTEM_PROMPT
    assert "SUBAGENT E: ATS AUDITOR" in REVIEW_SYSTEM_PROMPT
    assert "Do not rewrite the entire resume" in REVIEW_SYSTEM_PROMPT
    assert "# Critical Issues" in REVIEW_SYSTEM_PROMPT
    assert "Signal Strength: X/10" in REVIEW_SYSTEM_PROMPT


def test_build_review_prompt_contains_only_resume_text_not_metadata():
    prompt = build_review_prompt("Jane Doe\nBuilt dashboard\n")

    assert "RESUME TEXT:" in prompt
    assert "Jane Doe" in prompt
    assert "Built dashboard" in prompt
    assert "file:" not in prompt.lower()
    assert "path" not in prompt.lower()


def test_build_review_prompt_truncates_long_resume_text():
    prompt = build_review_prompt("a" * (MAX_RESUME_REVIEW_CHARS + 100))
    body = prompt.split("<<<RESUME\n", 1)[1].split("\nRESUME>>>", 1)[0]

    assert len(body) == MAX_RESUME_REVIEW_CHARS


def test_review_resume_text_calls_llm_with_review_system_prompt():
    llm = _CapturingLLM()

    out = review_resume_text(llm, "Jane Doe\nMade APIs", max_tokens=1234)

    assert out == "# Critical Issues\n- x"
    assert llm.last_system == REVIEW_SYSTEM_PROMPT
    assert llm.last_prompt and "Made APIs" in llm.last_prompt
    assert llm.last_max_tokens == 1234
