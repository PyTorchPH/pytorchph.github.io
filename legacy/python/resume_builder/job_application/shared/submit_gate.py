"""Reusable final-submit readiness checks for any browser application adapter."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from .access_gate import AccessGateResult, check_access_gate


class FinalSubmitGateResult(BaseModel):
    allowed: bool
    reason: str = ""
    access: AccessGateResult


def evaluate_final_submit_gate(page: Any, selector: str) -> FinalSubmitGateResult:
    """Require clear access and one visible, enabled final-submit control."""
    access = check_access_gate(page)
    if access.blocked:
        return FinalSubmitGateResult(
            allowed=False,
            reason=f"access gate: {access.reason}",
            access=access,
        )
    locator = page.locator(selector).first
    if locator.count() == 0:
        return FinalSubmitGateResult(
            allowed=False,
            reason="final submit control is missing",
            access=access,
        )
    if not locator.is_visible():
        return FinalSubmitGateResult(
            allowed=False,
            reason="final submit control is not visible",
            access=access,
        )
    if not locator.is_enabled():
        return FinalSubmitGateResult(
            allowed=False,
            reason="final submit control is disabled",
            access=access,
        )
    return FinalSubmitGateResult(allowed=True, access=access)
