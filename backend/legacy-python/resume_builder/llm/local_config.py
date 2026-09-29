"""Local, user-managed configuration for the provider-neutral model boundary."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from ..core.config import PROJECT_ROOT, Settings, get_settings
from .base import LLMProvider, LLMUnavailableError
from .litellm_provider import LiteLLMProvider

ProviderName = Literal[
    "google",
    "anthropic",
    "openai",
    "openai-compatible",
    "ollama",
    "openrouter",
    "azure",
    "other",
]

PROVIDER_CATALOG = [
    {
        "id": "google",
        "label": "Google Gemini",
        "modelPlaceholder": "gemini-2.5-flash",
        "apiKeyRequired": True,
        "baseUrlRequired": False,
        "help": "Google AI Studio API key; LiteLLM routes this through gemini/<model>.",
    },
    {
        "id": "anthropic",
        "label": "Anthropic Claude",
        "modelPlaceholder": "claude-sonnet-4-5-20250929",
        "apiKeyRequired": True,
        "baseUrlRequired": False,
        "help": "Anthropic API key; LiteLLM translates the shared message contract.",
    },
    {
        "id": "openai",
        "label": "OpenAI",
        "modelPlaceholder": "gpt-5-mini",
        "apiKeyRequired": True,
        "baseUrlRequired": False,
        "help": "OpenAI API key and model name.",
    },
    {
        "id": "openrouter",
        "label": "OpenRouter",
        "modelPlaceholder": "google/gemini-2.5-flash",
        "apiKeyRequired": True,
        "baseUrlRequired": False,
        "help": "OpenRouter API key and provider/model route.",
    },
    {
        "id": "openai-compatible",
        "label": "OpenAI-compatible server",
        "modelPlaceholder": "your-model-name",
        "apiKeyRequired": False,
        "baseUrlRequired": True,
        "help": "LM Studio, vLLM, LiteLLM Proxy, or another compatible HTTP server.",
    },
    {
        "id": "ollama",
        "label": "Ollama (local)",
        "modelPlaceholder": "qwen2.5:7b",
        "apiKeyRequired": False,
        "baseUrlRequired": True,
        "defaultBaseUrl": "http://127.0.0.1:11434",
        "help": "Direct local Ollama endpoint; no API key is normally required.",
    },
    {
        "id": "azure",
        "label": "Azure OpenAI",
        "modelPlaceholder": "deployment-name",
        "apiKeyRequired": True,
        "baseUrlRequired": True,
        "apiVersionSupported": True,
        "help": "Azure endpoint, deployment name, API key, and optional API version.",
    },
    {
        "id": "other",
        "label": "Other LiteLLM provider",
        "modelPlaceholder": "groq/llama-3.3-70b-versatile",
        "apiKeyRequired": False,
        "baseUrlRequired": False,
        "advancedSupported": True,
        "help": "Enter a full LiteLLM route such as vertex_ai/..., bedrock/..., or groq/... .",
    },
]


class _LocalAIFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: ProviderName = "google"
    model: str = Field(min_length=1, max_length=300)
    api_key: str | None = Field(default=None, max_length=4096)
    base_url: HttpUrl | None = None
    api_version: str | None = Field(default=None, max_length=80)
    project: str | None = Field(default=None, max_length=200)
    region: str | None = Field(default=None, max_length=120)


class LocalAIConfig(_LocalAIFields):
    """A normalized input; LiteLLM owns vendor-specific request translation."""

    @model_validator(mode="after")
    def validate_provider_requirements(self):
        catalog = next(item for item in PROVIDER_CATALOG if item["id"] == self.provider)
        if catalog["apiKeyRequired"] and not self.api_key:
            raise ValueError(f"{catalog['label']} requires an API key.")
        if catalog["baseUrlRequired"] and not self.base_url:
            raise ValueError(f"{catalog['label']} requires an API base URL.")
        if self.provider == "other" and "/" not in self.model:
            raise ValueError("Other LiteLLM providers require a provider/model route.")
        return self


class LocalAIConfigInput(_LocalAIFields):
    """Save payload; an omitted key preserves a secret only for the same provider."""


def local_ai_config_path() -> Path:
    configured = os.environ.get("RESUME_LOCAL_AI_CONFIG_PATH", "").strip()
    return Path(configured).expanduser() if configured else PROJECT_ROOT / "var" / "state" / "local-ai" / "config.json"


def load_local_ai_config() -> LocalAIConfig | None:
    path = local_ai_config_path()
    if not path.is_file():
        return None
    try:
        return LocalAIConfig.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def save_local_ai_config(value: LocalAIConfigInput) -> LocalAIConfig:
    path = local_ai_config_path()
    existing = load_local_ai_config()
    payload = value.model_dump(mode="json")
    if not value.api_key and existing and existing.api_key and existing.provider == value.provider:
        payload["api_key"] = existing.api_key
    saved = LocalAIConfig.model_validate(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(saved.model_dump_json(indent=2), encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)
    os.chmod(path, 0o600)
    return saved


def effective_local_ai_config(settings: Settings | None = None) -> LocalAIConfig | None:
    stored = load_local_ai_config()
    if stored is not None:
        return stored
    current = settings or get_settings()
    base_url = (current.llm_api_base_url or "").strip()
    model = (current.llm_model or current.openai_model or "").strip()
    key = current.llm_api_key or current.openai_api_key
    is_default_unconfigured = base_url.rstrip("/") == "https://api.openai.com/v1" and not key
    if (
        current.llm_provider not in {"openai", "openai-compatible"}
        or not base_url
        or not model
        or is_default_unconfigured
    ):
        return None
    return LocalAIConfig(
        provider="openai-compatible",
        base_url=base_url,
        model=model,
        api_key=key,
    )


def local_ai_status(settings: Settings | None = None) -> dict[str, object]:
    config = effective_local_ai_config(settings)
    if config is None:
        return {
            "configured": False,
            "provider": "",
            "baseUrl": "",
            "model": "",
            "apiKeyPresent": False,
            "apiVersion": "",
            "project": "",
            "region": "",
            "middleware": "litellm",
            "source": "none",
        }
    return {
        "configured": True,
        "provider": config.provider,
        "baseUrl": str(config.base_url).rstrip("/") if config.base_url else "",
        "model": config.model,
        "apiKeyPresent": bool(config.api_key),
        "apiVersion": config.api_version or "",
        "project": config.project or "",
        "region": config.region or "",
        "middleware": "litellm",
        "source": "settings" if load_local_ai_config() is not None else "environment",
    }


def get_configured_provider(settings: Settings | None = None) -> LLMProvider:
    config = effective_local_ai_config(settings)
    if config is None:
        raise LLMUnavailableError(
            "AI setup is required. Choose a provider, model, and credentials in Settings before running resume or scraper pipelines."
        )
    return LiteLLMProvider(config)
