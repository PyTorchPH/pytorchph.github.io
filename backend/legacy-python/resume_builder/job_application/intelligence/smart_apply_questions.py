"""Adaptive, evidence-grounded Smart Apply questionnaire planning."""

from __future__ import annotations

import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from resume_builder.core.models import Resume
from resume_builder.llm.base import LLMProvider

from ..autonomous_questions import QuestionPlanningResult
from ..deterministic_questions import (
    DeterministicQuestionResolver,
    VerifiedApplicationProfile,
)
from ..evidence_context import CareerEvidenceTool
from ..indeed_questionnaire import (
    ApprovedIndeedQuestionAnswers,
    question_set_fingerprint,
)
from ..models import DynamicInteractionStep, QuestionAnswer, ScreeningQuestion


class NovelQuestionJSON(BaseModel):
    """Strict model response accepted for one previously unseen question."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    question_id: str
    decision: Literal["answer", "abstain", "human_required"]
    answer: str = ""
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_ids: list[str] = Field(default_factory=list)
    rationale: str
    reusable: bool = False
    sensitivity: Literal[
        "standard",
        "personal",
        "legal",
        "compensation",
        "authorization",
    ] = "standard"

    @model_validator(mode="after")
    def validate_decision(self) -> "NovelQuestionJSON":
        if self.decision == "answer" and not self.answer.strip():
            raise ValueError("answer decision requires a non-empty answer")
        if self.decision != "answer" and self.answer.strip():
            raise ValueError("non-answer decisions must leave answer empty")
        return self


class SmartApplyAnswerSummary(BaseModel):
    label: str
    value: str
    source: Literal["saved", "resume", "runtime", "ai", "human_required"]


class SmartApplyPageSummary(BaseModel):
    schema_version: Literal[1] = 1
    question_set_fingerprint: str
    profile: dict[str, str]
    answers: list[SmartApplyAnswerSummary] = Field(default_factory=list)


class AdaptiveQuestionPlan(BaseModel):
    plan: QuestionPlanningResult
    persistable_answers: dict[str, str] = Field(default_factory=dict)
    summary: SmartApplyPageSummary


_AI_SYSTEM = """ROLE: evidence-grounded job-application question planner.
Goal: help the candidate present their truthful qualifications clearly and professionally.
Use only the supplied career evidence. Never invent or infer identity, location, employers, dates,
metrics, credentials, salary, work authorization, visa/sponsorship status, legal consent, protected
demographics, or availability. Explicit application_preferences are user-provided evidence and may
answer only the preference they state. Positively frame supported experience without exaggeration.
If evidence is insufficient, return abstain. A personal/legal/compensation/authorization decision
without an exact explicit preference returns human_required. Cite only supplied evidence_ids.
Respect the exact observed options and max_length. Output only the strict JSON object required by
the response schema.
"""

_NON_PERSISTENT = re.compile(
    r"\b(phone|mobile|telephone|email|e-mail|street|address|postal|zip|salary|"
    r"compensation|authori[sz]ation|visa|sponsor|consent|gender|race|ethnicity|"
    r"disabilit|veteran|criminal|background check|drug test)\b",
    re.IGNORECASE,
)


def is_reusable_question_label(label: str) -> bool:
    """Return whether a human-approved answer may enter the reusable question bank."""
    return not bool(_NON_PERSISTENT.search(label))


class SmartApplyNovelQuestionAnswerer:
    """Use a provider-neutral structured-output model only for safe novel questions."""

    def __init__(
        self,
        llm: LLMProvider,
        resume: Resume,
        *,
        application_preferences: dict[str, bool | str] | None = None,
    ) -> None:
        self.llm = llm
        self.evidence_tool = CareerEvidenceTool(resume)
        self.application_preferences = application_preferences or {}

    def has_matching_preference(self, question: ScreeningQuestion) -> bool:
        question_tokens = _semantic_tokens(question.label)
        return any(
            bool(question_tokens & _semantic_tokens(key)) for key in self.application_preferences
        )

    def answer(self, question: ScreeningQuestion) -> QuestionAnswer:
        evidence = self.evidence_tool.search(question.label)
        preference_evidence = [
            {
                "evidence_id": f"profile:{key}",
                "category": "explicit_application_preference",
                "text": f"{key}: {value}",
            }
            for key, value in self.application_preferences.items()
        ]
        if not evidence and not preference_evidence:
            return QuestionAnswer(
                question_id=question.question_id,
                abstain=True,
                rationale="no positively matched career evidence",
            )
        prompt = json.dumps(
            {
                "question": question.model_dump(mode="json"),
                "career_evidence": [item.model_dump(mode="json") for item in evidence],
                "application_preferences": preference_evidence,
            },
            ensure_ascii=False,
            indent=2,
        )
        decision = self.llm.structured(
            prompt,
            schema=NovelQuestionJSON,
            system=_AI_SYSTEM,
            max_tokens=1200,
        )
        valid_ids = {
            *[item.evidence_id for item in evidence],
            *[item["evidence_id"] for item in preference_evidence],
        }
        answer = decision.answer.strip()
        cited_preference_keys = [
            item.removeprefix("profile:")
            for item in decision.evidence_ids
            if item.startswith("profile:")
        ]
        preferences_match_question = all(
            bool(_semantic_tokens(question.label) & _semantic_tokens(key))
            for key in cited_preference_keys
        )
        sensitive_with_explicit_preference = (
            decision.sensitivity != "standard"
            and bool(decision.evidence_ids)
            and all(item.startswith("profile:") for item in decision.evidence_ids)
            and preferences_match_question
        )
        valid = (
            decision.question_id == question.question_id
            and decision.decision == "answer"
            and (decision.sensitivity == "standard" or sensitive_with_explicit_preference)
            and bool(decision.evidence_ids)
            and set(decision.evidence_ids).issubset(valid_ids)
            and (not question.options or answer in question.options)
            and (not question.max_length or len(answer) <= question.max_length)
        )
        if not valid:
            return QuestionAnswer(
                question_id=question.question_id,
                abstain=True,
                rationale=decision.rationale,
            )
        return QuestionAnswer(
            question_id=question.question_id,
            answer=answer,
            confidence=decision.confidence,
            evidence_ids=decision.evidence_ids,
            rationale=decision.rationale,
        )


def build_adaptive_indeed_question_plan(
    questions: list[ScreeningQuestion],
    *,
    resume: Resume,
    verified_profile: VerifiedApplicationProfile,
    exact: ApprovedIndeedQuestionAnswers | None = None,
    reusable_answers: dict[str, str] | None = None,
    application_preferences: dict[str, bool | str] | None = None,
    answerer: SmartApplyNovelQuestionAnswerer | None = None,
) -> AdaptiveQuestionPlan:
    """Reuse saved answers, then resume/runtime facts, then AI; fail closed otherwise."""
    fingerprint = question_set_fingerprint(questions)
    saved = dict(reusable_answers or {})
    preferences = dict(application_preferences or {})
    if exact and exact.question_set_fingerprint == fingerprint:
        saved.update(exact.answers)
    resolver = DeterministicQuestionResolver(
        resume,
        verified_profile=verified_profile,
    )
    result = QuestionPlanningResult()
    persistable: dict[str, str] = {}
    summaries: list[SmartApplyAnswerSummary] = []
    for step_number, question in enumerate(questions, start=1):
        value = saved.get(question.question_id, saved.get(question.label, "")).strip()
        source = "saved"
        value_source = "mongodb reusable question bank"
        evidence_ids: list[str] = []
        confidence = 1.0
        rationale = "exact normalized-label answer reused from MongoDB"
        if value and question.options and value not in question.options:
            value = ""
        if not value:
            value = _explicit_profile_answer(question, preferences)
            if value:
                value_source = "mongodb explicit application profile"
                rationale = "explicit user-approved application profile answer"
        if not value:
            decision = resolver.resolve(question)
            if decision.answer and decision.answer.answer:
                answer = decision.answer
                value = answer.answer
                confidence = answer.confidence
                evidence_ids = answer.evidence_ids
                rationale = answer.rationale
                value_source = decision.value_source
                source = (
                    "runtime" if decision.value_source.startswith("verified_profile.") else "resume"
                )
            elif answerer is not None and (
                decision.allow_ai or answerer.has_matching_preference(question)
            ):
                answer = answerer.answer(question)
                if not answer.abstain and answer.answer:
                    value = answer.answer
                    confidence = answer.confidence
                    evidence_ids = answer.evidence_ids
                    rationale = answer.rationale
                    value_source = "ai:bounded career evidence"
                    source = "ai"
        if (
            not value
            or not question.selector
            or question.kind == "unknown"
            or (question.options and value not in question.options)
        ):
            result.answers.append(
                QuestionAnswer(
                    question_id=question.question_id,
                    abstain=True,
                    rationale="no validated evidence-grounded answer is available",
                )
            )
            if question.required:
                result.unresolved.append(question.question_id)
            summaries.append(
                SmartApplyAnswerSummary(
                    label=question.label,
                    value="",
                    source="human_required",
                )
            )
            continue
        result.answers.append(
            QuestionAnswer(
                question_id=question.question_id,
                answer=value,
                confidence=confidence,
                evidence_ids=evidence_ids,
                rationale=rationale,
            )
        )
        result.steps.append(
            DynamicInteractionStep(
                step=step_number,
                action="select" if question.kind in {"select", "radio"} else "fill",
                selector=question.selector,
                purpose=f"answer observed Indeed question: {question.label}",
                expected_change="field contains the validated answer",
                value=value,
                value_source=value_source,
                action_class="draft_write",
            )
        )
        display_value = _masked_value(question.label, value)
        summaries.append(
            SmartApplyAnswerSummary(
                label=question.label,
                value=display_value,
                source=source,
            )
        )
        if is_reusable_question_label(question.label):
            persistable[question.question_id] = value
    profile = {
        "name": resume.contact.name,
        "country": verified_profile.country or (resume.contact.location or ""),
        "phone": _mask_phone(verified_profile.phone),
    }
    return AdaptiveQuestionPlan(
        plan=result,
        persistable_answers=persistable,
        summary=SmartApplyPageSummary(
            question_set_fingerprint=fingerprint,
            profile=profile,
            answers=summaries,
        ),
    )


def _explicit_profile_answer(
    question: ScreeningQuestion,
    preferences: dict[str, bool | str],
) -> str:
    """Map narrowly scoped profile answers to an observed Indeed question."""
    label = re.sub(r"\s+", " ", question.label).strip()
    context = re.sub(r"\s+", " ", question.context).strip()
    normalized_label = re.sub(r"[^a-z0-9]+", "_", label.casefold()).strip("_")
    for key, saved in preferences.items():
        normalized_key = re.sub(r"[^a-z0-9]+", "_", key.casefold()).strip("_")
        if normalized_key == normalized_label and isinstance(saved, (bool, str)):
            return str(saved).strip()
    sensitive_profile_keys = {
        "gender": r"^(?:what is your |please select your )?gender(?: identity)?[?*]?$",
        "disability_status": r"^(?:what is your |please select your )?disability status[?*]?$",
        "ethnicity": r"^(?:what is your |please select your )?ethnicity[?*]?$",
        "race": r"^(?:what is your |please select your )?race[?*]?$",
        "veteran_status": r"^(?:what is your |please select your )?veteran status[?*]?$",
        "salary_expectation": (
            r"^(?:what is your |please enter your )?(?:expected salary|salary expectation)[?*]?$"
        ),
    }
    for key, pattern in sensitive_profile_keys.items():
        saved = preferences.get(key)
        if re.fullmatch(pattern, label, re.IGNORECASE) and isinstance(saved, (bool, str)):
            return str(saved).strip()
    language_match = re.fullmatch(r"language\s+([12])", label, re.IGNORECASE)
    spoken_context = re.search(
        r"\b(?:speak|spoken|native|professional|business)\b",
        context,
        re.IGNORECASE,
    )
    if language_match and spoken_context:
        key = f"spoken_language_{language_match.group(1)}"
        value = preferences.get(key)
        return value.strip() if isinstance(value, str) else ""
    if (
        question.kind == "text"
        and re.search(r"\b(?:AI|artificial intelligence)\b", label, re.IGNORECASE)
        and re.search(r"\b(?:LLMs?|large language models?)\b", label, re.IGNORECASE)
        and re.search(r"\bexperience\b", label, re.IGNORECASE)
    ):
        value = preferences.get("ai_llm_experience_answer")
        return value.strip() if isinstance(value, str) else ""
    return ""


def _mask_phone(value: str) -> str:
    digits = "".join(character for character in value if character.isdigit())
    if not digits:
        return "not configured"
    prefix = f"+{digits[:2]}" if len(digits) >= 2 else "+"
    suffix = digits[-4:] if len(digits) >= 4 else digits
    return f"{prefix}••••••{suffix} (session only)"


def _masked_value(label: str, value: str) -> str:
    if re.search(r"\b(phone|mobile|telephone)\b", label, re.IGNORECASE):
        return _mask_phone(value)
    if re.search(r"\b(email|e-mail|street|address|postal|zip)\b", label, re.IGNORECASE):
        return "configured (private)"
    return value


def _semantic_tokens(value: str) -> set[str]:
    """Normalize DB preference keys and observed prose without question constants."""
    stopwords = {"are", "can", "do", "is", "the", "to", "you", "your"}
    tokens = set()
    for token in re.findall(r"[a-z0-9]+", value.casefold().replace("_", " ")):
        if token in stopwords or len(token) < 4:
            continue
        tokens.add(re.sub(r"(?:ing|ed|ion|e)$", "", token))
    return tokens
