from __future__ import annotations

from resume_builder.core.models import (
    Resume,
    ResumeAchievement,
    ResumeProject,
    ResumeSkillGroup,
    RoleSpec,
)
from resume_builder.job_application.evidence_context import CareerEvidenceTool
from resume_builder.job_application.models import QuestionAnswer, ScreeningQuestion
from resume_builder.job_application.question_answering import AIQuestionAnswerer
from resume_builder.job_application.autonomous_questions import AutonomousQuestionPipeline


def _resume() -> Resume:
    return Resume(
        role=RoleSpec(id="ml", label="ML Engineer"),
        skill_groups=[ResumeSkillGroup(name="Python", items=["PyTorch", "FastAPI"])],
        projects=[ResumeProject(name="Vision", description="Built an image classifier")],
        achievements=[ResumeAchievement(title="Hackathon", source="school", snippet="Won best AI demo")],
    )


class _LLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        assert "search_career_evidence" in prompt
        assert "PyTorch" in prompt
        return QuestionAnswer(
            question_id="q1",
            answer="PyTorch is included in my evidenced Python skill set.",
            evidence_ids=["skill_group:0"],
            confidence=0.9,
        )


def test_answerer_uses_bounded_resume_evidence_tool():
    answerer = AIQuestionAnswerer(_LLM(), CareerEvidenceTool(_resume()))
    answer = answerer.answer(ScreeningQuestion(
        question_id="q1", label="Describe your PyTorch experience", selector="#q1"
    ))
    assert answer.abstain is False
    assert "PyTorch" in answer.answer


class _HallucinatingLLM:
    called = False

    def structured(self, prompt, schema, system=None, max_tokens=2048):
        self.called = True
        return QuestionAnswer(question_id="q1", answer="Ten years", evidence_ids=["fake:99"])


def test_answerer_abstains_when_citation_is_not_in_tool_result():
    llm = _HallucinatingLLM()
    answerer = AIQuestionAnswerer(llm, CareerEvidenceTool(_resume()))
    answer = answerer.answer(ScreeningQuestion(
        question_id="q1", label="Years of COBOL experience", selector="#q1"
    ))
    assert answer.abstain is True
    assert answer.answer == ""
    assert llm.called is False


def test_evidence_tool_excludes_zero_match_resume_items():
    evidence = CareerEvidenceTool(_resume()).search("COBOL")

    assert evidence == []


def test_evidence_tool_ignores_question_boilerplate_for_unknown_tool():
    evidence = CareerEvidenceTool(_resume()).search("Describe your experience with n8n")

    assert evidence == []


def test_question_pipeline_emits_executable_draft_write():
    pipeline = AutonomousQuestionPipeline(AIQuestionAnswerer(_LLM(), CareerEvidenceTool(_resume())))
    result = pipeline.plan([ScreeningQuestion(
        question_id="q1", label="Describe your PyTorch experience", selector="#q1"
    )])
    assert result.unresolved == []
    assert result.steps[0].action == "fill"
    assert result.steps[0].action_class == "draft_write"
    assert result.steps[0].value_source == "ai:search_career_evidence"
