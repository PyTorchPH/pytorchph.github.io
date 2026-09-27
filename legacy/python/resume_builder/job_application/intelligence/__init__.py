"""Evidence-grounded decisions for variable application questions.

This layer may propose draft-safe answers. It does not own browser execution,
durable storage, permission policy, or final submission.
"""

from .smart_apply_questions import (
    AdaptiveQuestionPlan,
    NovelQuestionJSON,
    SmartApplyNovelQuestionAnswerer,
    SmartApplyPageSummary,
    build_adaptive_indeed_question_plan,
)

__all__ = [
    "AdaptiveQuestionPlan",
    "NovelQuestionJSON",
    "SmartApplyNovelQuestionAnswerer",
    "SmartApplyPageSummary",
    "build_adaptive_indeed_question_plan",
]
