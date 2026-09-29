from datetime import date

from resume_builder.core.models import (
    ContactInfo,
    Resume,
    ResumeEducation,
    RoleSpec,
)
from resume_builder.job_application import (
    AutonomousQuestionPipeline,
    DeterministicQuestionResolver,
    HybridQuestionPipeline,
    ScreeningQuestion,
    SmartApplyNovelQuestionAnswerer,
    VerifiedApplicationProfile,
    build_adaptive_indeed_question_plan,
)
from resume_builder.job_application.models import QuestionAnswer


def _resume() -> Resume:
    return Resume(
        role=RoleSpec(id="ai", label="AI Engineer"),
        contact=ContactInfo(
            name="John Andrew Balbarosa",
            location="Philippines",
            github="https://github.com/example",
        ),
        education=[
            ResumeEducation(
                school="FEU Institute of Technology",
                degree="Computer Science",
                field="Computer Software Engineering",
                end="Sep 2027",
            )
        ],
    )


def _question(
    question_id: str,
    label: str,
    *,
    kind: str = "text",
    options: list[str] | None = None,
) -> ScreeningQuestion:
    return ScreeningQuestion(
        question_id=question_id,
        label=label,
        selector=f"#{question_id}",
        kind=kind,
        options=options or [],
    )


class _RecordingAnswerer:
    def __init__(self) -> None:
        self.labels: list[str] = []

    def answer(self, question: ScreeningQuestion) -> QuestionAnswer:
        self.labels.append(question.label)
        return QuestionAnswer(
            question_id=question.question_id,
            answer="I built evidence-grounded agent orchestration projects.",
            confidence=0.9,
            evidence_ids=["project:1"],
        )


def test_standard_resume_and_verified_profile_questions_skip_ai():
    answerer = _RecordingAnswerer()
    resolver = DeterministicQuestionResolver(
        _resume(),
        verified_profile=VerifiedApplicationProfile(
            phone="+639123456789",
            country="Philippines",
        ),
        today=date(2026, 7, 24),
    )
    result = HybridQuestionPipeline(resolver, answerer).plan(
        [
            _question("name", "Legal name"),
            _question("generic_name", "Name"),
            _question("phone", "Mobile number"),
            _question(
                "graduate",
                "Do you have a completed Bachelor's degree?",
                kind="radio",
                options=["Yes", "No"],
            ),
            _question(
                "student",
                "Are you currently a student?",
                kind="radio",
                options=["Yes", "No"],
            ),
            _question("years", "Years of professional experience"),
        ]
    )

    assert answerer.labels == []
    assert result.unresolved == []
    assert [answer.answer for answer in result.answers] == [
        "John Andrew Balbarosa",
        "John Andrew Balbarosa",
        "+639123456789",
        "No",
        "Yes",
        "0",
    ]
    assert result.steps[0].value_source == "resume.contact.name"
    assert result.steps[2].value_source == "verified_profile.phone"
    assert result.steps[3].value_source == "resume.education[0].end"
    assert result.steps[5].value_source == "resume.experience"


def test_nonstandard_career_question_is_the_only_ai_intervention():
    answerer = _RecordingAnswerer()
    pipeline = HybridQuestionPipeline(
        DeterministicQuestionResolver(_resume()),
        answerer,
    )

    result = pipeline.plan(
        [
            _question("country", "Country"),
            _question("agents", "Describe your experience with AI agent orchestration"),
        ]
    )

    assert answerer.labels == ["Describe your experience with AI agent orchestration"]
    assert result.unresolved == []
    assert result.steps[0].value_source == "resume.contact.location"
    assert result.steps[1].value_source == "ai:search_career_evidence"


def test_backward_compatible_pipeline_is_deterministic_first():
    answerer = _RecordingAnswerer()
    answerer.evidence_tool = type("EvidenceTool", (), {"resume": _resume()})()

    result = AutonomousQuestionPipeline(answerer).plan(
        [_question("name", "Full name")]
    )

    assert answerer.labels == []
    assert result.answers[0].answer == "John Andrew Balbarosa"
    assert result.steps[0].value_source == "resume.contact.name"


def test_missing_private_and_judgment_values_never_call_ai():
    answerer = _RecordingAnswerer()
    pipeline = HybridQuestionPipeline(
        DeterministicQuestionResolver(_resume()),
        answerer,
    )

    result = pipeline.plan(
        [
            _question("email", "Email address"),
            _question("street", "Full address"),
            _question("salary", "Expected salary"),
            _question("visa", "Will you require visa sponsorship?"),
            _question("relocate", "Are you willing to relocate?"),
        ]
    )

    assert answerer.labels == []
    assert result.unresolved == ["email", "street", "salary", "visa", "relocate"]
    assert result.steps == []


def test_missing_employment_is_zero_only_for_explicit_total_experience():
    answerer = _RecordingAnswerer()
    pipeline = HybridQuestionPipeline(
        DeterministicQuestionResolver(_resume()),
        answerer,
    )

    result = pipeline.plan(
        [
            _question("years", "How many years of work experience do you have?"),
            _question("company", "Most recent employer"),
            _question("python", "How many years of experience with Python?"),
        ]
    )

    assert result.answers[0].answer == "0"
    assert result.answers[1].abstain is True
    assert answerer.labels == ["How many years of experience with Python?"]


def test_adaptive_plan_prioritizes_mongodb_then_profile_then_ai_and_masks_phone():
    answerer = _RecordingAnswerer()
    questions = [
        _question("saved", "Preferred language"),
        _question("relocate", "Are you willing to relocate?", kind="radio", options=["Yes", "No"]),
        _question("phone", "Mobile number"),
        _question("agents", "Describe your experience with AI agent orchestration"),
    ]

    adaptive = build_adaptive_indeed_question_plan(
        questions,
        resume=_resume(),
        verified_profile=VerifiedApplicationProfile(
            phone="+639123456789",
            country="Philippines",
        ),
        reusable_answers={
            "Preferred language": "English",
            "Are you willing to relocate?": "Yes",
        },
        answerer=answerer,
    )

    assert [answer.answer for answer in adaptive.plan.answers] == [
        "English",
        "Yes",
        "+639123456789",
        "I built evidence-grounded agent orchestration projects.",
    ]
    assert answerer.labels == ["Describe your experience with AI agent orchestration"]
    assert adaptive.persistable_answers == {
        "saved": "English",
        "relocate": "Yes",
        "agents": (
            "I built evidence-grounded agent orchestration projects."
        ),
    }
    phone_summary = next(
        item for item in adaptive.summary.answers if item.label == "Mobile number"
    )
    assert phone_summary.value.endswith("(session only)")
    assert "+639123456789" not in adaptive.summary.model_dump_json()


class _PreferenceLLM:
    def structured(self, prompt, schema, system, max_tokens):
        assert "willing_to_relocate" in prompt
        return schema(
            question_id="relocate",
            decision="answer",
            answer="Yes",
            confidence=1.0,
            evidence_ids=["profile:willing_to_relocate"],
            rationale="Explicit reusable application preference",
            reusable=True,
            sensitivity="personal",
        )


def test_sensitive_preference_is_data_driven_and_saved_after_first_observation():
    question = _question(
        "relocate",
        "Are you open to relocating?",
        kind="radio",
        options=["Yes", "No"],
    )
    answerer = SmartApplyNovelQuestionAnswerer(
        _PreferenceLLM(),
        _resume(),
        application_preferences={"willing_to_relocate": True},
    )

    adaptive = build_adaptive_indeed_question_plan(
        [question],
        resume=_resume(),
        verified_profile=VerifiedApplicationProfile(),
        answerer=answerer,
    )

    assert adaptive.plan.answers[0].answer == "Yes"
    assert adaptive.persistable_answers == {"relocate": "Yes"}


def test_explicit_spoken_languages_do_not_fill_programming_language_fields():
    questions = [
        _question("spoken-1", "Language 1", kind="select"),
        _question("spoken-2", "Language 2", kind="select"),
        _question("programming-1", "Language 1", kind="select"),
    ]
    questions[0].context = (
        "Which language(s) can you speak at a native or professional business level?"
    )
    questions[1].context = questions[0].context
    questions[2].context = "Select up to 3 programming languages and proficiency."

    adaptive = build_adaptive_indeed_question_plan(
        questions,
        resume=_resume(),
        verified_profile=VerifiedApplicationProfile(),
        application_preferences={
            "spoken_language_1": "English",
            "spoken_language_2": "Filipino",
        },
    )

    assert [answer.answer for answer in adaptive.plan.answers[:2]] == [
        "English",
        "Filipino",
    ]
    assert adaptive.plan.answers[2].abstain is True


def test_explicit_ai_llm_answer_integrates_without_runtime_model():
    question = _question(
        "ai-llm",
        "Please describe your experience with AI and large language models (LLMs).",
    )
    approved = "Built and evaluated LLM systems and contributed to LoRA fine-tuning."

    adaptive = build_adaptive_indeed_question_plan(
        [question],
        resume=_resume(),
        verified_profile=VerifiedApplicationProfile(),
        application_preferences={"ai_llm_experience_answer": approved},
    )

    assert adaptive.plan.answers[0].answer == approved
    assert adaptive.plan.steps[0].value_source == "mongodb explicit application profile"


def test_explicit_sensitive_profile_value_is_used_only_for_exact_supported_label():
    questions = [
        _question(
            "gender",
            "What is your gender?",
            kind="radio",
            options=["Woman", "Man", "Prefer not to say"],
        ),
        _question(
            "essay",
            "Describe how gender affects your work",
        ),
    ]

    adaptive = build_adaptive_indeed_question_plan(
        questions,
        resume=_resume(),
        verified_profile=VerifiedApplicationProfile(),
        application_preferences={"gender": "Prefer not to say"},
    )

    assert adaptive.plan.answers[0].answer == "Prefer not to say"
    assert adaptive.plan.answers[1].abstain is True
    assert "gender" not in adaptive.persistable_answers
