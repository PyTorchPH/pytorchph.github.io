"""Convert evidence-grounded AI answers into deterministic draft-write steps."""

from __future__ import annotations

from pydantic import BaseModel, Field

from .deterministic_questions import DeterministicQuestionResolver
from .models import DynamicInteractionStep, QuestionAnswer, ScreeningQuestion
from .question_answering import AIQuestionAnswerer


class QuestionPlanningResult(BaseModel):
    answers: list[QuestionAnswer] = Field(default_factory=list)
    steps: list[DynamicInteractionStep] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list)


class AutonomousQuestionPipeline:
    """Backward-compatible entrypoint with deterministic-first behavior."""

    def __init__(
        self,
        answerer: AIQuestionAnswerer,
        resolver: DeterministicQuestionResolver | None = None,
    ) -> None:
        self.answerer = answerer
        self.resolver = resolver or DeterministicQuestionResolver(
            answerer.evidence_tool.resume
        )

    def plan(self, questions: list[ScreeningQuestion], *, starting_step: int = 1) -> QuestionPlanningResult:
        return HybridQuestionPipeline(self.resolver, self.answerer).plan(
            questions,
            starting_step=starting_step,
        )


class HybridQuestionPipeline:
    """Prefer deterministic resume facts and call AI only for non-standard questions."""

    def __init__(
        self,
        resolver: DeterministicQuestionResolver,
        answerer: AIQuestionAnswerer | None = None,
    ) -> None:
        self.resolver = resolver
        self.answerer = answerer

    def plan(
        self,
        questions: list[ScreeningQuestion],
        *,
        starting_step: int = 1,
    ) -> QuestionPlanningResult:
        result = QuestionPlanningResult()
        for offset, question in enumerate(questions):
            decision = self.resolver.resolve(question)
            answer = decision.answer
            value_source = decision.value_source
            if answer is None and decision.allow_ai and self.answerer is not None:
                answer = self.answerer.answer(question)
                value_source = "ai:search_career_evidence"
            if answer is None:
                answer = QuestionAnswer(
                    question_id=question.question_id,
                    abstain=True,
                    rationale=decision.unresolved_reason,
                )
            result.answers.append(answer)
            if answer.abstain or not answer.answer:
                result.unresolved.append(question.question_id)
                continue
            action = "select" if question.kind in {"select", "radio"} else "fill"
            result.steps.append(DynamicInteractionStep(
                step=starting_step + offset,
                action=action,
                selector=question.selector,
                purpose=f"answer screening question {question.question_id}",
                expected_change="field contains an evidence-grounded answer",
                value=answer.answer,
                value_source=value_source,
                action_class="draft_write",
            ))
        return result
