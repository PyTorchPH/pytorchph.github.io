from __future__ import annotations

from resume_builder.job_application.ledger import ApplicationLedger, LedgerState
from resume_builder.job_application.permissions import ApplicationPermissionPolicy


def test_permission_bypass_is_scoped_by_action_and_domain():
    policy = ApplicationPermissionPolicy(
        autonomous_sensitive_writes=True,
        autonomous_submit=True,
        allowed_domains={"apply.example.com"},
    )
    assert policy.allows("sensitive_write", domain="apply.example.com")
    assert policy.allows("irreversible", domain="apply.example.com")
    assert not policy.allows("irreversible", domain="evil.example.net")


def test_ledger_persists_submission_state(tmp_path):
    ledger = ApplicationLedger(tmp_path / "applications.json")
    ledger.set("company:job-1", LedgerState.SUBMITTING)
    ledger.set("company:job-1", LedgerState.SUBMITTED, "REF-1")
    restored = ApplicationLedger(tmp_path / "applications.json").get("company:job-1")
    assert restored is not None
    assert restored.state == LedgerState.SUBMITTED
    assert restored.confirmation == "REF-1"
