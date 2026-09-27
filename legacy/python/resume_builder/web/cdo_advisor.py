"""CDO Advisor v1: AI JSON extraction, deterministic scoring.

The AI layer is intentionally limited to structured interpretation: tags and MCQ
questions. Scores are computed here with explicit weights so the interpretation
is reproducible and testable.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from ..llm import LLMProvider


class AdvisorEvidence(BaseModel):
    id: str
    title: str
    source: str
    text: str
    url: str | None = None


class AdvisorAnalyzeRequest(BaseModel):
    student_id: str = "demo-student"
    target_role: str = "Full-Stack Development Internship"
    achievements: list[AdvisorEvidence] = Field(default_factory=list)
    mcq_answers: dict[str, str] = Field(default_factory=dict)


class AdvisorTag(BaseModel):
    evidence_id: str
    competency: str
    category: Literal[
        "technical",
        "project_delivery",
        "leadership",
        "communication",
        "certification",
        "career_readiness",
    ]
    confidence: float = Field(..., ge=0, le=1)
    rationale: str


class AdvisorChoice(BaseModel):
    id: str
    text: str


class AdvisorQuestion(BaseModel):
    question_id: str
    competency: str
    prompt: str
    choices: list[AdvisorChoice] = Field(default_factory=list)
    correct_choice_id: str
    difficulty: Literal["easy", "medium", "hard"] = "medium"


class AdvisorAIOutput(BaseModel):
    tags: list[AdvisorTag] = Field(default_factory=list)
    questions: list[AdvisorQuestion] = Field(default_factory=list)


class AdvisorScoreBreakdown(BaseModel):
    achievement_score: int
    mcq_score: int | None
    readiness_score: int
    answered_questions: int
    total_questions: int
    method: str


class AdvisorInjection(BaseModel):
    tags: list[AdvisorTag]
    questions: list[AdvisorQuestion]
    scores: AdvisorScoreBreakdown


class AdvisorAnalyzeResponse(BaseModel):
    version: str = "cdo-advisor-v1"
    injection: AdvisorInjection


_SYSTEM = (
    "You are the CDO Advisor JSON tagger. Return JSON only through the provided schema. "
    "Your job is interpretation only: tag student evidence and create short MCQ questions "
    "that test the tagged competencies. Do not compute readiness scores, averages, grades, "
    "or final recommendations. The application computes all math deterministically."
)


def analyze_for_injection(
    request: AdvisorAnalyzeRequest,
    llm: LLMProvider,
) -> AdvisorAnalyzeResponse:
    ai_output = llm.structured(
        _build_prompt(request),
        schema=AdvisorAIOutput,
        system=_SYSTEM,
        max_tokens=3072,
    )
    scores = score_advisor_output(ai_output, request)
    return AdvisorAnalyzeResponse(
        injection=AdvisorInjection(
            tags=ai_output.tags,
            questions=ai_output.questions,
            scores=scores,
        )
    )


def score_advisor_output(
    ai_output: AdvisorAIOutput,
    request: AdvisorAnalyzeRequest,
) -> AdvisorScoreBreakdown:
    achievement_score = _achievement_score(ai_output.tags, request.achievements)
    mcq_score = _mcq_score(ai_output.questions, request.mcq_answers)
    if mcq_score is None:
        readiness = achievement_score
        method = "achievement-only"
    else:
        readiness = round((achievement_score * 0.65) + (mcq_score * 0.35))
        method = "65% achievement + 35% mcq"
    return AdvisorScoreBreakdown(
        achievement_score=achievement_score,
        mcq_score=mcq_score,
        readiness_score=_clamp_int(readiness),
        answered_questions=len(request.mcq_answers),
        total_questions=len(ai_output.questions),
        method=method,
    )


def _achievement_score(tags: list[AdvisorTag], evidence: list[AdvisorEvidence]) -> int:
    if not tags:
        return 0
    evidence_by_id = {item.id: item for item in evidence}
    weighted_sum = 0.0
    total_weight = 0.0
    for tag in tags:
        item = evidence_by_id.get(tag.evidence_id)
        source = (item.source if item else "").lower()
        weight = _source_weight(source) * _category_weight(tag.category)
        weighted_sum += tag.confidence * weight
        total_weight += weight
    base = (weighted_sum / total_weight) * 100 if total_weight else 0
    coverage_bonus = min(10, len({tag.evidence_id for tag in tags}) * 2)
    competency_bonus = min(8, len({tag.competency.lower() for tag in tags}) * 1.5)
    return _clamp_int(round(base + coverage_bonus + competency_bonus))


def _mcq_score(questions: list[AdvisorQuestion], answers: dict[str, str]) -> int | None:
    if not questions or not answers:
        return None
    earned = 0.0
    possible = 0.0
    for question in questions:
        weight = _difficulty_weight(question.difficulty)
        possible += weight
        if answers.get(question.question_id) == question.correct_choice_id:
            earned += weight
    if possible == 0:
        return None
    return _clamp_int(round((earned / possible) * 100))


def _source_weight(source: str) -> float:
    if "github" in source:
        return 1.0
    if "linkedin" in source:
        return 0.95
    if "certificate" in source or "badge" in source:
        return 0.9
    if "facebook" in source:
        return 0.85
    if "resume" in source or "document" in source:
        return 0.8
    return 0.75


def _category_weight(category: str) -> float:
    return {
        "technical": 1.0,
        "project_delivery": 1.0,
        "leadership": 0.9,
        "communication": 0.8,
        "certification": 0.75,
        "career_readiness": 0.7,
    }.get(category, 0.75)


def _difficulty_weight(difficulty: str) -> float:
    return {"easy": 1.0, "medium": 1.5, "hard": 2.0}.get(difficulty, 1.5)


def _clamp_int(value: float | int) -> int:
    return max(0, min(100, int(round(value))))


def _build_prompt(request: AdvisorAnalyzeRequest) -> str:
    evidence_blob = "\n".join(
        f"[{item.id}] source={item.source}\ntitle={item.title}\ntext={item.text[:700]}"
        for item in request.achievements
    ) or "(no evidence)"
    return (
        f"Target role: {request.target_role}\n"
        f"Student id: {request.student_id}\n\n"
        f"Evidence:\n{evidence_blob}\n\n"
        "Return tags for the evidence and 3-5 MCQ questions. Each question should test "
        "a competency that appears in the tags. Use stable ids like q1, q2 and choice ids "
        "like a, b, c, d."
    )
