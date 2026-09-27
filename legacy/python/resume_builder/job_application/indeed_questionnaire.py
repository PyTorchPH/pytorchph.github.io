"""Deterministic planning for user-approved Indeed questionnaire answers."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .autonomous_questions import QuestionPlanningResult
from .models import DynamicInteractionStep, QuestionAnswer, ScreeningQuestion


class ApprovedIndeedQuestionAnswers(BaseModel):
    """A local, reviewable answer artifact scoped to one exact question set."""

    domain: Literal["smartapply.indeed.com"] = "smartapply.indeed.com"
    question_set_fingerprint: str
    answers: dict[str, str] = Field(default_factory=dict)

    @field_validator("question_set_fingerprint")
    @classmethod
    def require_fingerprint(cls, value: str) -> str:
        clean = value.strip().lower()
        if len(clean) != 40 or any(character not in "0123456789abcdef" for character in clean):
            raise ValueError("question_set_fingerprint must be a SHA-1 hex digest")
        return clean

    @field_validator("answers")
    @classmethod
    def require_exact_nonempty_answers(cls, value: dict[str, str]) -> dict[str, str]:
        clean = {label.strip(): answer.strip() for label, answer in value.items()}
        if any(not label or not answer for label, answer in clean.items()):
            raise ValueError("approved question labels and answers must be nonempty")
        return clean


class ApprovedIndeedQuestionAnswerSet(BaseModel):
    """Approved page profiles selected only by their observed question fingerprint."""

    domain: Literal["smartapply.indeed.com"] = "smartapply.indeed.com"
    pages: list[ApprovedIndeedQuestionAnswers]

    @model_validator(mode="after")
    def require_unique_pages(self) -> "ApprovedIndeedQuestionAnswerSet":
        fingerprints = [page.question_set_fingerprint for page in self.pages]
        if not fingerprints:
            raise ValueError("at least one approved questionnaire page is required")
        if len(fingerprints) != len(set(fingerprints)):
            raise ValueError("approved questionnaire page fingerprints must be unique")
        return self

    def matching(
        self,
        questions: list[ScreeningQuestion],
    ) -> ApprovedIndeedQuestionAnswers | None:
        fingerprint = question_set_fingerprint(questions)
        return next(
            (page for page in self.pages if page.question_set_fingerprint == fingerprint),
            None,
        )


def question_set_fingerprint(questions: list[ScreeningQuestion]) -> str:
    payload = [
        {
            "label": question.label,
            "context": question.context,
            "kind": question.kind,
            # Indeed virtualizes large select menus, so the mounted option subset
            # is not stable enough to identify the questionnaire. The executor
            # still requires one exact live option match before selecting.
            "options": [] if question.kind == "select" else question.options,
            "required": question.required,
        }
        for question in questions
    ]
    canonical = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha1(canonical.encode("utf-8")).hexdigest()


def _question_context(label: Any) -> str:
    """Return the nearest preceding prompt/header outside another question control."""
    return str(
        label.evaluate(
            """element => {
                const item = element.closest('.ia-Questions-item');
                let sibling = item ? item.previousElementSibling : null;
                while (sibling) {
                    const containsQuestion = sibling.querySelector(
                        '[data-testid^="input-q_"]'
                    );
                    const text = (sibling.innerText || '')
                        .replace(/\\s+/g, ' ')
                        .trim();
                    if (!containsQuestion && text) return text;
                    sibling = sibling.previousElementSibling;
                }
                return '';
            }"""
        )
    ).strip()


def observe_indeed_screening_questions(page: Any) -> list[ScreeningQuestion]:
    """Inventory every rendered question without reading cookies or storage state."""
    questions: list[ScreeningQuestion] = []
    labels = page.locator('[data-testid^="input-q_"][data-testid$="-label"]')
    for index in range(labels.count()):
        label = labels.nth(index)
        test_id = label.get_attribute("data-testid") or ""
        question_id = test_id.removeprefix("input-").removesuffix("-label")
        if not question_id:
            continue
        label_text = label.inner_text().strip()
        context = _question_context(label)
        required = bool(page.locator(f'[data-testid="input-{question_id}-label-asterisk"]').count())
        group_selector = f'[data-testid="input-{question_id}"]'
        group = page.locator(group_selector)
        combo_selector = f'[data-testid="input-{question_id}-select-list-select-list"]'
        combo = page.locator(combo_selector)
        text_selector = f'[name="{question_id}"]'
        text = page.locator(text_selector)
        if group.count() and group.first.get_attribute("role") == "radiogroup":
            option_labels = group.first.locator("label")
            options = [
                option_labels.nth(option_index).inner_text().strip()
                for option_index in range(option_labels.count())
                if option_labels.nth(option_index).inner_text().strip()
            ]
            kind = "radio"
            selector = group_selector
        elif combo.count():
            # Select options are virtualized and may be absent, partial, or stale
            # until the menu is filtered. Validate the approved value against the
            # exact rendered option during execution instead.
            options = []
            kind = "select"
            selector = combo_selector
        elif text.count():
            options = []
            kind = "text"
            selector = text_selector
        else:
            questions.append(
                ScreeningQuestion(
                    question_id=question_id,
                    label=label_text,
                    selector="",
                    context=context,
                    kind="unknown",
                    required=required,
                )
            )
            continue
        questions.append(
            ScreeningQuestion(
                question_id=question_id,
                label=label_text,
                selector=selector,
                context=context,
                kind=kind,
                options=options,
                required=required,
            )
        )
    return questions


def observe_indeed_question_answers(
    page: Any,
    questions: list[ScreeningQuestion],
) -> dict[str, str]:
    """Read only visible questionnaire values; never inspect cookies or browser storage."""
    answers: dict[str, str] = {}
    for question in questions:
        value = ""
        if question.kind == "radio":
            group = page.locator(question.selector)
            if group.count():
                checked = group.first.locator("input:checked")
                if checked.count():
                    selected = checked.first
                    label = group.first.locator("label:has(input:checked)")
                    value = (
                        label.first.inner_text().strip()
                        if label.count()
                        else (selected.get_attribute("value") or "").strip()
                    )
        elif question.kind == "select":
            control = page.locator(question.selector)
            if control.count():
                value = control.first.input_value().strip()
        elif question.selector:
            control = page.locator(question.selector)
            if control.count():
                value = control.first.input_value().strip()
        if value:
            answers[question.question_id] = value
    return answers


def build_approved_indeed_question_plan(
    questions: list[ScreeningQuestion],
    approved: ApprovedIndeedQuestionAnswers | None,
) -> QuestionPlanningResult:
    """Accept only exact labels, exact enumerated options, and an exact question fingerprint."""
    result = QuestionPlanningResult()
    if approved is None:
        result.unresolved.extend(question.question_id for question in questions)
        return result
    actual_fingerprint = question_set_fingerprint(questions)
    if actual_fingerprint != approved.question_set_fingerprint:
        result.unresolved.extend(question.question_id for question in questions)
        return result
    for step, question in enumerate(questions, start=1):
        value = approved.answers.get(question.label, "").strip()
        if not value and not question.required:
            result.answers.append(
                QuestionAnswer(
                    question_id=question.question_id,
                    abstain=True,
                    rationale="optional question has no user-approved answer",
                )
            )
            continue
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
                    rationale="no exact user-approved answer matches the observed question",
                )
            )
            result.unresolved.append(question.question_id)
            continue
        result.answers.append(
            QuestionAnswer(
                question_id=question.question_id,
                answer=value,
                confidence=1.0,
                rationale="exact match from local user-approved Indeed answer profile",
            )
        )
        result.steps.append(
            DynamicInteractionStep(
                step=step,
                action="select" if question.kind in {"select", "radio"} else "fill",
                selector=question.selector,
                purpose=f"answer exact observed Indeed question: {question.label}",
                expected_change="the exact approved answer is selected or entered",
                value=value,
                value_source="runtime user-approved Indeed answer profile",
                action_class="draft_write",
            )
        )
    return result
