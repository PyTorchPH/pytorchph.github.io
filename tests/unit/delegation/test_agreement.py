from __future__ import annotations

from datetime import datetime, timezone

from org_ops.delegation.agreement import sign_node
from org_ops.delegation.models import DelegationNode, Level


def test_sign_stamps_signature_and_timestamp():
    n = DelegationNode(id="a", level=Level.EXEC, owner_role="Exec")
    fixed = datetime(2026, 6, 30, 12, 0, tzinfo=timezone.utc)
    signed = sign_node(n, signer="Juan", e_signature="JUAN-SIG", now=lambda: fixed)
    assert signed.agreement.signed_by == "Juan"
    assert signed.agreement.e_signature == "JUAN-SIG"
    assert signed.agreement.signed_at == fixed.isoformat()
    assert n.agreement.signed_by is None  # original untouched (immutable)
