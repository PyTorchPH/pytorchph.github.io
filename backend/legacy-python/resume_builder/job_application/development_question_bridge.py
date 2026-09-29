"""Local development artifact bridge for interactive-session questionnaire fixtures."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from resume_builder.core.models import Resume

from .evidence_context import CareerEvidenceTool
from .intelligence.smart_apply_questions import NovelQuestionJSON
from .models import ScreeningQuestion
from .persistence.questionnaire_store import MongoQuestionnaireRepository


class DevelopmentQuestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    request_id: str
    domain: str
    company: str
    job_title: str
    questions: list[ScreeningQuestion]
    evidence: dict[str, list[dict[str, str]]] = Field(default_factory=dict)
    created_at: str


class DevelopmentQuestionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    request_id: str
    answers: list[NovelQuestionJSON]


class DevelopmentQuestionBridge:
    """Exchange sanitized request/response JSON without embedding a chat provider."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.requests = root / "requests"
        self.responses = root / "responses"
        self.requests.mkdir(parents=True, exist_ok=True)
        self.responses.mkdir(parents=True, exist_ok=True)

    def create_request(
        self,
        *,
        domain: str,
        company: str,
        job_title: str,
        questions: list[ScreeningQuestion],
        resume: Resume,
    ) -> DevelopmentQuestionRequest:
        identity = "\n".join(
            [domain, company, job_title, *[question.model_dump_json() for question in questions]]
        )
        request_id = hashlib.sha256(identity.encode()).hexdigest()[:24]
        tool = CareerEvidenceTool(resume)
        evidence = {
            question.question_id: [item.model_dump(mode="json") for item in tool.search(question.label)]
            for question in questions
        }
        request = DevelopmentQuestionRequest(
            request_id=request_id,
            domain=domain,
            company=company,
            job_title=job_title,
            questions=questions,
            evidence=evidence,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self._write(self.requests / f"{request_id}.json", request.model_dump(mode="json"))
        return request

    def pending(self) -> list[DevelopmentQuestionRequest]:
        values = []
        for path in sorted(self.requests.glob("*.json")):
            if (self.responses / path.name).exists():
                continue
            try:
                values.append(DevelopmentQuestionRequest.model_validate_json(path.read_text()))
            except (OSError, ValueError):
                continue
        return values

    def accept(
        self,
        response: DevelopmentQuestionResponse,
        *,
        repository: MongoQuestionnaireRepository,
    ) -> int:
        request_path = self.requests / f"{response.request_id}.json"
        if not request_path.is_file():
            raise KeyError(response.request_id)
        request = DevelopmentQuestionRequest.model_validate_json(request_path.read_text())
        questions = {question.question_id: question for question in request.questions}
        response_ids = [decision.question_id for decision in response.answers]
        if len(response_ids) != len(set(response_ids)) or set(response_ids) != set(questions):
            raise ValueError("development response must answer every requested question exactly once")
        accepted: dict[str, str] = {}
        for decision in response.answers:
            question = questions.get(decision.question_id)
            if question is None:
                raise ValueError(f"unknown question_id: {decision.question_id}")
            valid_evidence = {
                str(item.get("evidence_id", ""))
                for item in request.evidence.get(question.question_id, [])
            }
            answer = decision.answer.strip()
            if (
                decision.decision != "answer"
                or decision.sensitivity != "standard"
                or not decision.evidence_ids
                or not set(decision.evidence_ids).issubset(valid_evidence)
                or (question.options and answer not in question.options)
                or (question.max_length and len(answer) > question.max_length)
            ):
                raise ValueError(f"development answer failed validation: {question.question_id}")
            accepted[question.question_id] = answer
        repository.save_observed_page(
            request.questions,
            accepted,
            domain=request.domain,
            source="validated current-session development artifact",
        )
        self._write(
            self.responses / f"{response.request_id}.json",
            response.model_dump(mode="json"),
        )
        return len(accepted)

    @staticmethod
    def _write(path: Path, payload: object) -> None:
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        temporary.replace(path)
