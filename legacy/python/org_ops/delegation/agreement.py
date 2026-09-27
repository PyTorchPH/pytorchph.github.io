from __future__ import annotations

from datetime import datetime, timezone

from .models import Agreement, DelegationNode


def sign_node(
    node: DelegationNode, signer: str, e_signature: str, now=None
) -> DelegationNode:
    """AgreeToSign: clicking 'Agree' stamps the signer's e-signature + timestamp on the node."""
    clock = now or (lambda: datetime.now(timezone.utc))
    stamped = Agreement(
        signed_by=signer, e_signature=e_signature, signed_at=clock().isoformat()
    )
    return node.model_copy(update={"agreement": stamped})
