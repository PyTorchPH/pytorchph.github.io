from __future__ import annotations

from resume_builder.extractors import StaticExtractor
from resume_builder.core.models import Repo, RoleSpec


def _role() -> RoleSpec:
    return RoleSpec(
        id="cybersecurity-blueteam",
        label="Cybersecurity Blue Team",
        keywords=["SIEM", "incident response", "Splunk"],
        must_have_skills=["log analysis"],
        nice_to_have=["YARA"],
    )


def test_extractor_filters_irrelevant_repos(config_dir):
    extractor = StaticExtractor(config_dir / "regex_patterns.json", min_score=1.0)
    repos = [
        Repo(
            name="cooking-blog",
            full_name="me/cooking-blog",
            url="https://github.com/me/cooking-blog",
            description="Recipes and food photography.",
            languages=["JavaScript"],
            topics=["food"],
            readme="A blog about pasta.",
        ),
        Repo(
            name="soc-playbook",
            full_name="me/soc-playbook",
            url="https://github.com/me/soc-playbook",
            description="SOC analyst Splunk detection playbook for incident response.",
            languages=["Python"],
            topics=["security", "siem"],
            readme="Includes Suricata, Sigma rules, log analysis automation.",
        ),
    ]
    evidence = extractor.extract(repos, _role())
    assert len(evidence) == 1
    assert evidence[0].source_id == "me/soc-playbook"
    assert evidence[0].score > 1.0
    assert "Splunk" in evidence[0].matched_terms or "SIEM" in evidence[0].matched_terms


def test_extractor_archived_skipped(config_dir):
    extractor = StaticExtractor(config_dir / "regex_patterns.json", min_score=0.1)
    repos = [
        Repo(
            name="soc-playbook",
            full_name="me/soc-playbook",
            url="https://github.com/me/soc-playbook",
            description="SIEM Splunk",
            archived=True,
        ),
    ]
    assert extractor.extract(repos, _role()) == []

def test_suggest_bullets_dedupes_and_excludes_languages():
    repo = Repo(
        name="proj",
        full_name="me/proj",
        url="https://github.com/me/proj",
        description="A project.",
        languages=["Python", "TypeScript"],
    )
    # matched has a language in two cases (Python/python) plus non-language terms.
    matched = {"Python", "python", "TypeScript", "RAG", "LLM"}
    bullets = StaticExtractor._suggest_bullets(repo, matched)
    assert len(bullets) == 1
    text = bullets[0]
    assert text.startswith("Demonstrates: ")
    # No duplicate description bullet.
    assert "A project" not in text
    # Languages excluded (already shown in the Tech line).
    assert "Python" not in text and "TypeScript" not in text
    # Non-language matched terms kept.
    assert "RAG" in text and "LLM" in text


def test_suggest_bullets_empty_when_only_languages_match():
    repo = Repo(
        name="p", full_name="me/p", url="u", description="d", languages=["Python"],
    )
    assert StaticExtractor._suggest_bullets(repo, {"Python", "python"}) == []
