from __future__ import annotations

import sys
from types import SimpleNamespace

from resume_builder.llm.litellm_provider import LiteLLMProvider, litellm_model_route
from resume_builder.llm.local_config import LocalAIConfig


def test_known_providers_map_to_one_litellm_model_parameter():
    assert litellm_model_route("google", "gemini-2.5-flash") == "gemini/gemini-2.5-flash"
    assert litellm_model_route("anthropic", "claude-sonnet-4-5") == "anthropic/claude-sonnet-4-5"
    assert litellm_model_route("openrouter", "google/gemini-2.5-flash") == "openrouter/google/gemini-2.5-flash"
    assert litellm_model_route("other", "groq/llama-3.3-70b") == "groq/llama-3.3-70b"


def test_provider_normalizes_google_call_without_environment_mutation(monkeypatch):
    captured = {}

    def completion(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="READY"))],
            usage=SimpleNamespace(prompt_tokens=4, completion_tokens=2, total_tokens=6),
        )

    monkeypatch.setitem(sys.modules, "litellm", SimpleNamespace(completion=completion))
    provider = LiteLLMProvider(
        LocalAIConfig(
            provider="google",
            model="gemini-2.5-flash",
            api_key="student-key",
        )
    )

    assert provider.complete("health", system="test", max_tokens=8) == "READY"
    assert captured["model"] == "gemini/gemini-2.5-flash"
    assert captured["api_key"] == "student-key"
    assert captured["messages"] == [
        {"role": "system", "content": "test"},
        {"role": "user", "content": "health"},
    ]
    assert provider.usage_snapshot() == {
        "calls": 1,
        "prompt_tokens": 4,
        "completion_tokens": 2,
        "total_tokens": 6,
        "model": "gemini/gemini-2.5-flash",
    }
