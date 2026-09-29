from __future__ import annotations

from resume_builder.core.models import (
    DocumentType,
    Evidence,
    RawDocument,
    Repo,
    RoleSpec,
)
from resume_builder.synthesizers import StaticSynthesizer


def test_static_synth_parses_latex_sections():
    role = RoleSpec(id="r", label="Role", keywords=["SIEM"], must_have_skills=["log analysis"])
    repos = [
        Repo(
            name="soc-playbook",
            full_name="me/soc-playbook",
            url="https://github.com/me/soc-playbook",
            description="SOC detection playbook",
            languages=["Python"],
        )
    ]
    evidence = [
        Evidence(
            source_kind="repo",
            source_id="me/soc-playbook",
            snippet="SIEM detection",
            matched_terms=["SIEM"],
            score=5.0,
            bullets=["Detection content."],
        )
    ]
    tex = r"""
\name{Drew Doe}
Contact: drew@example.com, https://github.com/drew

\section{Experience}
Senior Engineer at Acme
- Built detection pipeline
- Cut MTTD in half

\section{Education}
University of Example
- BS Computer Science, 2024

\section{Certifications}
- Security+
- OSCP
"""
    docs = [RawDocument(path="r.tex", filename="r.tex", doc_type=DocumentType.TEX, text=tex)]
    resume = StaticSynthesizer().build(role, repos, evidence, docs)

    assert resume.contact.email == "drew@example.com"
    assert resume.contact.github == "https://github.com/drew"
    assert resume.experience and resume.experience[0].company == "Acme"
    assert resume.education and resume.education[0].school == "University of Example"
    assert any(c.name == "OSCP" for c in resume.certifications)
    assert resume.projects and resume.projects[0].name == "soc-playbook"
    assert "log analysis" in resume.skills
