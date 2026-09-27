"""Website-agnostic application automation primitives."""

from .access_gate import (
    AccessGateResult,
    AccessGateState,
    check_access_gate,
    sanitize_application_url,
)
from .resume_matcher import ResumeArtifactProfile, select_resume_artifact
from .submit_gate import FinalSubmitGateResult, evaluate_final_submit_gate

__all__ = [
    "AccessGateResult",
    "AccessGateState",
    "FinalSubmitGateResult",
    "ResumeArtifactProfile",
    "check_access_gate",
    "evaluate_final_submit_gate",
    "sanitize_application_url",
    "select_resume_artifact",
]
