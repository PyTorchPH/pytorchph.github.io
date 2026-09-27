"""Scoped permissions for autonomous application actions."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ApplicationPermissionPolicy(BaseModel):
    autonomous_draft_writes: bool = True
    autonomous_sensitive_writes: bool = False
    autonomous_submit: bool = False
    allowed_domains: set[str] = Field(default_factory=set)

    def allows(self, action_class: str, *, domain: str = "") -> bool:
        if self.allowed_domains and domain.lower() not in {
            item.lower() for item in self.allowed_domains
        }:
            return False
        return {
            "read_only": True,
            "draft_write": self.autonomous_draft_writes,
            "sensitive_write": self.autonomous_sensitive_writes,
            "irreversible": self.autonomous_submit,
        }.get(action_class, False)


NON_BYPASSABLE_STOPS = frozenset(
    {"captcha", "verification_required", "rate_limited", "blocked", "signed_out",
     "domain_mismatch", "layout_mismatch", "submission_unknown"}
)
