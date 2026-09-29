from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class PlatformInfo(BaseModel):
    vendor: str
    confidence: float = 0.0
    evidence: list[str] = Field(default_factory=list)


class WorkflowInfo(BaseModel):
    states: list[str] = Field(default_factory=list)
    current_state: str = ""


class DetectedField(BaseModel):
    selector_hint: str
    canonical: str
    kind: str
    required: bool = False
    mapped_value: str | None = None
    source: str | None = None
    confidence: float = 0.0


class RequiredDocument(BaseModel):
    type: str
    format: str = "pdf"
    source: str | None = None
    ready: bool = False


class MissingInformation(BaseModel):
    canonical: str
    label: str
    reason: str


class UploadStrategy(BaseModel):
    field: str
    method: str = "file_input"
    artifact: str = ""
    auto_parse_expected: bool = False


class BrowserAction(BaseModel):
    step: int
    action: str
    target: str
    value: str = ""
    value_source: str = "literal"
    action_class: Literal["read_only", "draft_write", "sensitive_write", "irreversible"] = "draft_write"


class WebsitePageSample(BaseModel):
    url: str
    subdomain: str
    layout_fingerprint: str
    page_role: str = "unknown"
    dom_inventory: str = ""


class ApplicationDomRule(BaseModel):
    """Executable DOM classification shared by inspection and debug visualization."""

    selector: str
    role: Literal[
        "questionnaire_container",
        "question_field",
        "resume_choice",
        "resume_upload",
        "work_mode_choice",
        "extract",
        "click",
        "continue_review",
        "final_submit",
        "ignore",
        "auth_check",
    ]
    purpose: str = ""
    include_descendants: bool = False
    requires_human: bool = False

    @model_validator(mode="after")
    def protect_resume_and_transition_gates(self) -> "ApplicationDomRule":
        gated = {"resume_choice", "resume_upload", "continue_review", "final_submit"}
        if self.role in gated and not self.requires_human:
            raise ValueError(f"{self.role} DOM rule requires requires_human=True")
        return self


class DynamicInteractionStep(BaseModel):
    step: int
    action: str
    selector: str
    purpose: str
    wait_for_selector: str | None = None
    expected_change: str = ""
    safe_read_only: bool = False
    requires_human: bool = False
    value: str = ""
    value_source: str = "literal"
    action_class: Literal["read_only", "draft_write", "sensitive_write", "irreversible"] = "read_only"

    @model_validator(mode="after")
    def protect_final_submit(self) -> "DynamicInteractionStep":
        if self.action == "final_submit" and not self.requires_human:
            raise ValueError("final_submit interaction requires requires_human=True")
        if self.action == "final_submit":
            self.action_class = "irreversible"
        return self


class DynamicApplicationPlan(BaseModel):
    root_domain: str
    samples: list[WebsitePageSample] = Field(default_factory=list)
    page_roles: list[str] = Field(default_factory=list)
    dom_rules: list[ApplicationDomRule] = Field(default_factory=list)
    interaction_steps: list[DynamicInteractionStep] = Field(default_factory=list)
    confidence: float = 0.0
    warnings: list[str] = Field(default_factory=list)
    job_id: str = ""
    plan_version: str = "1"


class ValidationStep(BaseModel):
    check: str
    selector: str = ""
    expected: str = "visible"
    required: bool = True


class RecoveryRule(BaseModel):
    on: str
    do: str
    max_attempts: int = 3


class Hitl(BaseModel):
    stop_before: str = "Submit"
    status: str = "awaiting_human_review"


class ApplicationPlan(BaseModel):
    platform: PlatformInfo
    workflow: WorkflowInfo
    detected_fields: list[DetectedField] = Field(default_factory=list)
    required_documents: list[RequiredDocument] = Field(default_factory=list)
    missing_information: list[MissingInformation] = Field(default_factory=list)
    upload_strategy: UploadStrategy | None = None
    browser_actions: list[BrowserAction] = Field(default_factory=list)
    validation_steps: list[ValidationStep] = Field(default_factory=list)
    recovery_plan: list[RecoveryRule] = Field(default_factory=list)
    hitl: Hitl = Field(default_factory=Hitl)

    @model_validator(mode="after")
    def enforce_hitl_gate(self) -> ApplicationPlan:
        if self.hitl.stop_before != "Submit":
            raise ValueError(
                f"HITL gate violation: stop_before must be 'Submit', got '{self.hitl.stop_before}'"
            )
        return self


class ScreeningQuestion(BaseModel):
    question_id: str
    label: str
    selector: str
    context: str = ""
    kind: str = "text"
    options: list[str] = Field(default_factory=list)
    required: bool = False
    max_length: int | None = None


class EvidenceCitation(BaseModel):
    evidence_id: str
    category: str
    text: str


class QuestionAnswer(BaseModel):
    question_id: str
    answer: str = ""
    confidence: float = 0.0
    evidence_ids: list[str] = Field(default_factory=list)
    rationale: str = ""
    abstain: bool = False
