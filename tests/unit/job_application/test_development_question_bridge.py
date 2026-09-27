from resume_builder.core.models import Resume, RoleSpec
from resume_builder.job_application import (
    DevelopmentQuestionBridge,
    DevelopmentQuestionResponse,
    NovelQuestionJSON,
    ScreeningQuestion,
)


class _Repository:
    def __init__(self):
        self.saved = None

    def save_observed_page(self, questions, answers, *, domain, source):
        self.saved = {
            "questions": questions,
            "answers": answers,
            "domain": domain,
            "source": source,
        }


def _request(bridge: DevelopmentQuestionBridge):
    return bridge.create_request(
        domain="smartapply.indeed.com",
        company="Example",
        job_title="Python Engineer",
        questions=[
            ScreeningQuestion(
                question_id="python",
                label="Describe your Python experience",
                selector="#python",
                kind="text",
                required=True,
                max_length=120,
            )
        ],
        resume=Resume(role=RoleSpec(id="python", label="Python Engineer"), skills=["Python"]),
    )


def test_development_bridge_accepts_evidence_grounded_standard_answer(tmp_path):
    bridge = DevelopmentQuestionBridge(tmp_path / "bridge")
    request = _request(bridge)
    evidence_id = request.evidence["python"][0]["evidence_id"]
    repository = _Repository()

    accepted = bridge.accept(
        DevelopmentQuestionResponse(
            request_id=request.request_id,
            answers=[
                NovelQuestionJSON(
                    question_id="python",
                    decision="answer",
                    answer="I use Python to build tested automation and machine-learning systems.",
                    confidence=0.9,
                    evidence_ids=[evidence_id],
                    rationale="The resume explicitly lists Python.",
                    reusable=True,
                    sensitivity="standard",
                )
            ],
        ),
        repository=repository,
    )

    assert accepted == 1
    assert repository.saved["answers"]["python"].startswith("I use Python")
    assert bridge.pending() == []


def test_development_bridge_rejects_unsupported_or_sensitive_answer(tmp_path):
    bridge = DevelopmentQuestionBridge(tmp_path / "bridge")
    request = _request(bridge)
    repository = _Repository()

    response = DevelopmentQuestionResponse(
        request_id=request.request_id,
        answers=[
            NovelQuestionJSON(
                question_id="python",
                decision="answer",
                answer="Unsupported",
                confidence=1,
                evidence_ids=["invented:evidence"],
                rationale="Invented",
                sensitivity="personal",
            )
        ],
    )

    try:
        bridge.accept(response, repository=repository)
    except ValueError as exc:
        assert "failed validation" in str(exc)
    else:
        raise AssertionError("unsupported answer should fail closed")
