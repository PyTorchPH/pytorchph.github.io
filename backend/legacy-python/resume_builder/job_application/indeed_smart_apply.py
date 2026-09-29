"""Deterministic planning for the verified Indeed Smart Apply module sequence."""

from __future__ import annotations

from enum import Enum
import json
from pathlib import Path
import re
from typing import Sequence
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from resume_builder.core.models import Resume

from .models import BrowserAction
from .shared import ResumeArtifactProfile, select_resume_artifact


class IndeedSmartApplyModule(str, Enum):
    CONTACT = "contact"
    LOCATION = "location"
    RESUME = "resume"
    RELEVANT_EXPERIENCE = "relevant_experience"
    QUESTIONS = "questions"
    REVIEW = "review"
    POST_APPLY = "post_apply"
    UNKNOWN = "unknown"


class SmartApplyApprovals(BaseModel):
    resume_upload: bool = False
    resume_continue: bool = False
    final_submit: bool = False


class SmartApplyModulePlan(BaseModel):
    module: IndeedSmartApplyModule
    browser_actions: list[BrowserAction] = Field(default_factory=list)
    stop_reason: str = ""
    requires_ai_fallback: bool = False
    selected_resume: str = ""
    warnings: list[str] = Field(default_factory=list)


def load_resume_artifact(path: Path) -> Resume:
    """Load generated resume JSON while discarding renderer-only metadata."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    canonical = {name: payload[name] for name in Resume.model_fields if name in payload}
    return Resume.model_validate(canonical)


def classify_indeed_smart_apply_module(page_url: str) -> IndeedSmartApplyModule:
    host = (urlsplit(page_url).hostname or "").lower()
    path = urlsplit(page_url).path.rstrip("/")
    if host != "smartapply.indeed.com":
        return IndeedSmartApplyModule.UNKNOWN
    if path.endswith("/contact-info-module"):
        return IndeedSmartApplyModule.CONTACT
    if path.endswith("/profile-location"):
        return IndeedSmartApplyModule.LOCATION
    if path.endswith("/resume-selection-module/resume-selection"):
        return IndeedSmartApplyModule.RESUME
    if path.endswith("/resume-module/relevant-experience"):
        return IndeedSmartApplyModule.RELEVANT_EXPERIENCE
    if "/questions-module" in path:
        return IndeedSmartApplyModule.QUESTIONS
    if path.endswith("/review-module"):
        return IndeedSmartApplyModule.REVIEW
    if path.endswith("/post-apply"):
        return IndeedSmartApplyModule.POST_APPLY
    return IndeedSmartApplyModule.UNKNOWN


def recommend_role_resume(
    job_title: str,
    artifact_dir: Path,
    *,
    job_description: str = "",
    profiles: Sequence[ResumeArtifactProfile] = (),
    default_filename: str | None = None,
) -> Path | None:
    """Apply caller-provided profile configuration through the shared matcher."""
    return select_resume_artifact(
        job_title,
        artifact_dir,
        profiles,
        job_description=job_description,
        default_filename=default_filename,
    )


def _split_name(full_name: str) -> tuple[str, str]:
    parts = full_name.split()
    if len(parts) < 2:
        return (parts[0] if parts else "", "")
    return " ".join(parts[:-1]), parts[-1]


def _phone_digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def _national_phone(verified_phone: str, country_calling_code: str) -> str:
    phone = _phone_digits(verified_phone)
    prefix = _phone_digits(country_calling_code)
    if prefix and phone.startswith(prefix):
        return phone[len(prefix) :]
    return phone


def build_indeed_smart_apply_plan(
    page_url: str,
    resume: Resume,
    *,
    field_values: dict[str, str] | None = None,
    selected_resume: str = "",
    approved_resume: Path | None = None,
    approvals: SmartApplyApprovals | None = None,
    verified_phone: str = "",
    phone_country_calling_code: str = "",
    phone_country_iso: str = "",
) -> SmartApplyModulePlan:
    """Plan exactly one visible module; the caller executes and re-observes after navigation."""
    module = classify_indeed_smart_apply_module(page_url)
    values = field_values or {}
    gates = approvals or SmartApplyApprovals()
    plan = SmartApplyModulePlan(module=module, selected_resume=selected_resume)

    if module == IndeedSmartApplyModule.UNKNOWN:
        plan.requires_ai_fallback = True
        plan.stop_reason = "unrecognized Indeed Smart Apply module; bounded AI sampling required"
        return plan

    if module == IndeedSmartApplyModule.CONTACT:
        first, last = _split_name(resume.contact.name)
        if not first or not last:
            plan.stop_reason = "resume contact name cannot be split into first and last name"
            return plan
        current_first = values.get("first_name", "").strip()
        current_last = values.get("last_name", "").strip()
        if current_first != first:
            plan.browser_actions.append(
                BrowserAction(
                    step=1,
                    action="fill",
                    target="[data-testid=name-fields-first-name-input]",
                    value=first,
                    value_source="resume.contact.name",
                )
            )
        if current_last != last:
            plan.browser_actions.append(
                BrowserAction(
                    step=2,
                    action="fill",
                    target="[data-testid=name-fields-last-name-input]",
                    value=last,
                    value_source="resume.contact.name",
                )
            )
        if current_first and current_first != first:
            plan.warnings.append(
                "prefilled first name differs from the verified resume name and requires correction"
            )
        if current_last and current_last != last:
            plan.warnings.append(
                "prefilled last name differs from the verified resume name and requires correction"
            )
        expected_phone = _national_phone(verified_phone, phone_country_calling_code)
        if not expected_phone:
            plan.stop_reason = "verified phone number is unavailable; human input is required"
            plan.warnings.append("phone is never inferred from the resume or generated")
            return plan
        current_phone_country = values.get("phone_country_iso", "").strip().upper()
        verified_phone_country = phone_country_iso.strip().upper()
        next_step = 3
        country_changed = False
        if current_phone_country and current_phone_country != verified_phone_country:
            if not verified_phone_country:
                plan.stop_reason = (
                    "phone country differs from the application locale and no "
                    "runtime-verified country is available"
                )
                return plan
            if not re.fullmatch(r"[A-Z]{2}", verified_phone_country):
                plan.stop_reason = "runtime-verified phone country must be an ISO alpha-2 code"
                return plan
            plan.browser_actions.extend(
                (
                    BrowserAction(
                        step=next_step,
                        action="click",
                        target="[role=combobox][aria-haspopup=listbox]",
                        value_source="runtime verified contact profile",
                        action_class="sensitive_write",
                    ),
                    BrowserAction(
                        step=next_step + 1,
                        action="click",
                        target=f"[data-testid=country-select-{verified_phone_country}]",
                        value_source="runtime verified contact profile",
                        action_class="sensitive_write",
                    ),
                )
            )
            next_step += 2
            country_changed = True
            plan.warnings.append(
                "application locale phone country is replaced only with the "
                "runtime-verified contact country"
            )
        if country_changed or _phone_digits(values.get("phone", "")) != expected_phone:
            plan.browser_actions.append(
                BrowserAction(
                    step=next_step,
                    action="fill",
                    target="input[name=phone]",
                    value=expected_phone,
                    value_source="runtime verified contact profile",
                    action_class="sensitive_write",
                )
            )
            next_step += 1
        plan.browser_actions.append(
            BrowserAction(
                step=next_step,
                action="click",
                target="button:visible:has-text('Continue')",
            )
        )
        plan.warnings.append(
            "matching contact fields are left untouched; email is preserved and phone is verified"
        )
        return plan

    if module == IndeedSmartApplyModule.LOCATION:
        country = values.get("country", "").strip()
        if country and country.lower() not in resume.contact.location.lower():
            plan.stop_reason = "saved country conflicts with resume location"
            return plan
        plan.browser_actions.append(
            BrowserAction(
                step=1,
                action="click",
                target="button:visible:has-text('Continue')",
            )
        )
        plan.warnings.append("postal code, city, and street remain blank without resume evidence")
        return plan

    if module == IndeedSmartApplyModule.RESUME:
        if approved_resume is None or not approved_resume.is_file():
            plan.stop_reason = "human must approve one real role-specific resume artifact"
            return plan
        plan.selected_resume = approved_resume.name
        if selected_resume == approved_resume.name:
            if not gates.resume_continue:
                plan.stop_reason = "uploaded resume preview requires human approval"
                return plan
            plan.browser_actions.append(
                BrowserAction(step=1, action="click", target="[data-testid=continue-button]")
            )
            return plan
        if not gates.resume_upload:
            plan.stop_reason = f"approval required to upload {approved_resume.name}"
            return plan
        plan.browser_actions.append(
            BrowserAction(
                step=1,
                action="upload",
                target="[data-testid=resume-selection-file-resume-radio-card-file-input]",
                value=str(approved_resume.resolve()),
                value_source="human-approved role-specific artifact",
                action_class="sensitive_write",
            )
        )
        plan.stop_reason = "stop after upload for human preview; do not continue"
        return plan

    if module == IndeedSmartApplyModule.RELEVANT_EXPERIENCE:
        if resume.experience:
            experience = resume.experience[0]
            plan.browser_actions.extend(
                [
                    BrowserAction(
                        step=1,
                        action="fill",
                        target="#job-title-input",
                        value=experience.role,
                        value_source="resume.experience[0].role",
                    ),
                    BrowserAction(
                        step=2,
                        action="fill",
                        target="#company-name-input",
                        value=experience.company,
                        value_source="resume.experience[0].company",
                    ),
                ]
            )
        else:
            plan.warnings.append(
                "resume.experience is empty; achievements, leadership, and projects are not employment"
            )
        plan.browser_actions.append(
            BrowserAction(step=3, action="click", target="[data-testid=continue-button]")
        )
        return plan

    if module == IndeedSmartApplyModule.QUESTIONS:
        plan.requires_ai_fallback = True
        plan.stop_reason = "questionnaire requires an accepted evidence-grounded answer plan"
        return plan

    if module == IndeedSmartApplyModule.REVIEW:
        plan.stop_reason = "final submit requires explicit human approval"
        if gates.final_submit:
            plan.browser_actions.append(
                BrowserAction(
                    step=1,
                    action="final_submit",
                    target="[data-testid=submit-application-button]",
                    action_class="irreversible",
                )
            )
        return plan

    plan.stop_reason = "application already submitted"
    return plan
