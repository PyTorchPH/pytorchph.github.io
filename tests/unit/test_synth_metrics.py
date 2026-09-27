"""The AI synthesizer must ground bullets on provided metrics and forbid invention."""

from __future__ import annotations

from resume_builder.llm.base import LLMProvider
from resume_builder.metrics import ProjectMetric
from resume_builder.core.models import ContactInfo, Evidence, Resume, RoleSpec
from resume_builder.synthesizers.ai_synth import AISynthesizer


class _CapturingLLM(LLMProvider):
    """Records the prompt/system it is handed and returns a minimal valid Resume."""

    name = "capturing"

    def __init__(self) -> None:
        self.prompt = ""
        self.system = ""

    def complete(self, prompt: str, system: str | None = None, max_tokens: int = 1024) -> str:
        return ""

    def structured(self, prompt, schema, system=None, max_tokens=2048):  # type: ignore[override]
        self.prompt = prompt
        self.system = system or ""
        return Resume(role=RoleSpec(id="r", label="R"), contact=ContactInfo(name="X"))


def _role() -> RoleSpec:
    return RoleSpec(id="r", label="ML Engineer")


def test_metrics_are_injected_as_authoritative_facts():
    llm = _CapturingLLM()
    metrics = [
        ProjectMetric(repo="rag-bot", metric_label="docs indexed", value="2.1M chunks", context="wiki"),
        ProjectMetric(repo="rag-bot", metric_label="users served", value="1.2k/mo"),
    ]
    synth = AISynthesizer(llm, metrics=metrics)
    synth.build(_role(), repos=[], evidence=[Evidence(source_kind="repo", source_id="me/rag-bot")], documents=[])

    assert "Authoritative metrics" in llm.prompt
    assert "docs indexed: 2.1M chunks (wiki)" in llm.prompt
    assert "users served: 1.2k/mo" in llm.prompt
    # System prompt must explicitly forbid inventing numbers.
    assert "NEVER invent" in llm.system


def test_no_metrics_emits_qualitative_guard():
    llm = _CapturingLLM()
    synth = AISynthesizer(llm, metrics=[])
    synth.build(_role(), repos=[], evidence=[], documents=[])
    assert "none provided" in llm.prompt
    assert "qualitative" in llm.system.lower()


def test_system_requests_compact_skill_ecosystems_and_explained_results():
    llm = _CapturingLLM()
    AISynthesizer(llm).build(_role(), repos=[], evidence=[], documents=[])
    assert "JavaScript -> ReactJS, React Native, Vue" in llm.system
    assert "new short bullet/sentence" in llm.system
