"""Evidence-grounded AI intervention for application screening questions."""

from __future__ import annotations

import json

from resume_builder.llm.base import LLMProvider

from .evidence_context import CareerEvidenceTool
from .models import QuestionAnswer, ScreeningQuestion

_SYSTEM = """ROLE: job-application screening-question answerer.
Use only the supplied normalized career evidence. Never invent employers, dates, metrics,
skills, authorization, salary, identity, or credentials. Cite evidence_ids supporting the answer.
If evidence is insufficient, set abstain=true and leave answer empty. Respect provided options and
max_length. Return concise, truthful, professional wording as strict structured JSON.
"""


class AIQuestionAnswerer:
    def __init__(self, llm: LLMProvider, evidence_tool: CareerEvidenceTool) -> None:
        self.llm = llm
        self.evidence_tool = evidence_tool

    def answer(self, question: ScreeningQuestion) -> QuestionAnswer:
        evidence = self.evidence_tool.search(question.label)
        if not evidence:
            return QuestionAnswer(
                question_id=question.question_id,
                abstain=True,
                rationale="no positively matched career evidence",
            )
        prompt = (
            "QUESTION:\n" + question.model_dump_json(indent=2)
            + "\n\nTOOL RESULT search_career_evidence:\n"
            + json.dumps([item.model_dump() for item in evidence], indent=2)
        )
        answer = self.llm.structured(prompt, schema=QuestionAnswer, system=_SYSTEM, max_tokens=1024)
        valid_ids = {item.evidence_id for item in evidence}
        if not answer.evidence_ids or not set(answer.evidence_ids).issubset(valid_ids):
            answer.abstain = True
            answer.answer = ""
        if question.options and answer.answer not in question.options:
            answer.abstain = True
            answer.answer = ""
        if question.max_length and len(answer.answer) > question.max_length:
            answer.answer = answer.answer[: question.max_length].rstrip()
        answer.question_id = question.question_id
        return answer
