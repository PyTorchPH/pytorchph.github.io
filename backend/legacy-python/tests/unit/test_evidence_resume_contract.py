import json
from pathlib import Path

from resume_builder.core.evidence_contract import EvidenceBackedResume

ROOT = Path(__file__).parents[4]
TEMPLATE = ROOT / "frontend/contracts/resumes/evidence-backed/template.v1.json"


def test_template_parses_and_builds_backend_profile() -> None:
    document = EvidenceBackedResume.model_validate(json.loads(TEMPLATE.read_text(encoding="utf-8")))

    profile = document.renderable_profile("backend-engineer")

    assert profile["projects"][0]["title"] == "GabayBigkas"
    assert "8,628 authenticated reads" in profile["projects"][0]["bullets"][0]


def test_unverified_claim_cannot_be_rendered() -> None:
    payload = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    claim = payload["entries"][0]["claims"][0]
    claim["evidence"]["status"] = "unverified"
    claim["evidence"]["resumeEligible"] = False

    document = EvidenceBackedResume.model_validate(payload)

    assert document.renderable_profile("backend-engineer")["projects"] == []
