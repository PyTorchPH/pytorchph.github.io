from __future__ import annotations

import stat

import pytest

from resume_builder.core.config import get_settings
from resume_builder.llm.base import LLMUnavailableError
from resume_builder.llm.local_config import (
    LocalAIConfigInput,
    get_configured_provider,
    local_ai_status,
    save_local_ai_config,
)
from resume_builder.web import org_event_api


@pytest.fixture(autouse=True)
def isolate_model_environment(monkeypatch):
    for name in ("RESUME_LLM_API_KEY", "OPENAI_API_KEY", "RESUME_LLM_MODEL"):
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_local_ai_settings_are_private_and_status_is_masked(tmp_path, monkeypatch):
    path = tmp_path / "private" / "local-ai.json"
    monkeypatch.setenv("RESUME_LOCAL_AI_CONFIG_PATH", str(path))

    save_local_ai_config(
        LocalAIConfigInput(
            provider="openai-compatible",
            base_url="http://127.0.0.1:11434/v1",
            model="qwen2.5:7b",
            api_key="secret-value",
        )
    )

    status = local_ai_status()
    assert status == {
        "configured": True,
        "provider": "openai-compatible",
        "baseUrl": "http://127.0.0.1:11434/v1",
        "model": "qwen2.5:7b",
        "apiKeyPresent": True,
        "apiVersion": "",
        "project": "",
        "region": "",
        "middleware": "litellm",
        "source": "settings",
    }
    assert "secret-value" not in str(status)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_scraper_pipeline_stops_at_ai_gate_before_browser(tmp_path, monkeypatch):
    monkeypatch.setenv("RESUME_LOCAL_AI_CONFIG_PATH", str(tmp_path / "missing.json"))
    browser_called = False

    def unexpected_browser(_url: str):
        nonlocal browser_called
        browser_called = True
        raise AssertionError("browser should not open")

    monkeypatch.setattr(org_event_api, "_visible_page_text", unexpected_browser)
    value, status_code = org_event_api.execute_event_pipeline("https://example.com/event")

    assert status_code == 409
    assert value["status"] == "failed"
    assert value["stages"][0]["status"] == "failed"
    assert all(stage["status"] == "blocked" for stage in value["stages"][1:])
    assert browser_called is False


def test_missing_configuration_has_actionable_error(tmp_path, monkeypatch):
    monkeypatch.setenv("RESUME_LOCAL_AI_CONFIG_PATH", str(tmp_path / "missing.json"))
    with pytest.raises(LLMUnavailableError, match="Settings"):
        get_configured_provider()


def test_google_and_anthropic_require_their_own_key(tmp_path, monkeypatch):
    monkeypatch.setenv("RESUME_LOCAL_AI_CONFIG_PATH", str(tmp_path / "local-ai.json"))
    with pytest.raises(ValueError, match="Google Gemini requires an API key"):
        save_local_ai_config(LocalAIConfigInput(provider="google", model="gemini-2.5-flash"))


def test_switching_provider_never_reuses_another_vendor_secret(tmp_path, monkeypatch):
    monkeypatch.setenv("RESUME_LOCAL_AI_CONFIG_PATH", str(tmp_path / "local-ai.json"))
    save_local_ai_config(
        LocalAIConfigInput(provider="google", model="gemini-2.5-flash", api_key="google-secret")
    )
    with pytest.raises(ValueError, match="Anthropic Claude requires an API key"):
        save_local_ai_config(
            LocalAIConfigInput(provider="anthropic", model="claude-sonnet-4-5-20250929")
        )
