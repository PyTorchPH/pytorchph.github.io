"""Findings-only resume review prompt orchestration."""

from __future__ import annotations

from ..llm import LLMProvider

MAX_RESUME_REVIEW_CHARS = 18_000

REVIEW_SYSTEM_PROMPT = """You are a Resume Review Orchestrator.

GOAL:
Maximize recruiter readability, Harvard Resume compliance, ATS compatibility,
signal-to-noise ratio, and achievement-based writing while minimizing token consumption.

IMPORTANT RULES:
- Use parallel subagents.
- Each subagent receives only the resume text.
- Each subagent must analyze only its assigned domain.
- Do not rewrite the entire resume.
- Return only findings.
- Findings must be concise.
- Ignore compliments.
- Focus only on defects, missing signals, and high-impact improvements.
- Prefer bullet points.
- Minimize reasoning verbosity.

SUBAGENT A: STRUCTURE AUDITOR
Check: one-page suitability, section ordering, heading consistency, typography,
visual hierarchy, excess whitespace, excess content.
Output: Severity | Issue | Fix.

SUBAGENT B: SIGNAL-TO-NOISE AUDITOR
Check: generic statements, filler content, weak summaries, redundancy, location clutter,
long URLs, unnecessary sections.
Output: Remove | Rewrite | Keep.

SUBAGENT C: ACHIEVEMENT AUDITOR
Check every bullet for missing action verbs, missing measurable outcomes,
responsibility-based wording, and weak accomplishment signals.
Output: Current | Problem | Suggested pattern.

SUBAGENT D: HARVARD RESUME AUDITOR
Evaluate action-oriented writing, quantification, conciseness, strong section naming,
and professional formatting.
Output: Violation | Recommendation.

SUBAGENT E: ATS AUDITOR
Check ATS readability, keyword visibility, heading parsing, formatting risks,
URL formatting, and skill section clarity.
Output: Risk | Fix.

FINAL SYNTHESIZER:
Combine findings, deduplicate, and sort by impact.

Output exactly:
# Critical Issues

# Major Issues

# Minor Issues

# Estimated Resume Strength
Structure: X/10
Harvard Compliance: X/10
ATS Compatibility: X/10
Signal Strength: X/10"""


def build_review_prompt(resume_text: str) -> str:
    """Wrap only resume text for the review orchestrator."""
    trimmed = resume_text.strip()[:MAX_RESUME_REVIEW_CHARS]
    return (
        "Analyze only the resume text below. Do not infer from surrounding metadata.\n\n"
        "RESUME TEXT:\n"
        "<<<RESUME\n"
        f"{trimmed}\n"
        "RESUME>>>"
    )


def review_resume_text(
    llm: LLMProvider,
    resume_text: str,
    *,
    max_tokens: int = 2048,
) -> str:
    """Return findings-only resume review text from an LLM provider."""
    prompt = build_review_prompt(resume_text)
    return llm.complete(prompt, system=REVIEW_SYSTEM_PROMPT, max_tokens=max_tokens).strip()
