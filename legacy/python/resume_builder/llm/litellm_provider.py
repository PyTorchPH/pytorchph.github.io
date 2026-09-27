"""One normalized runtime adapter for LiteLLM's provider matrix."""

from __future__ import annotations

from threading import Lock
from typing import TYPE_CHECKING, Any

from .base import LLMProvider, LLMUnavailableError

if TYPE_CHECKING:
    from .local_config import LocalAIConfig


_PROVIDER_PREFIXES = {
    "google": "gemini",
    "anthropic": "anthropic",
    "openai": "openai",
    "openai-compatible": "openai",
    "ollama": "ollama",
    "openrouter": "openrouter",
    "azure": "azure",
}


def litellm_model_route(provider: str, model: str) -> str:
    """Convert the simple UI provider + model pair into LiteLLM's route format."""
    cleaned = model.strip()
    if provider == "other" or "/" in cleaned and cleaned.split("/", 1)[0] in {
        *_PROVIDER_PREFIXES.values(),
        "vertex_ai",
        "bedrock",
        "groq",
        "mistral",
        "deepseek",
        "xai",
    }:
        return cleaned
    return f"{_PROVIDER_PREFIXES[provider]}/{cleaned}"


class LiteLLMProvider(LLMProvider):
    """Translate the application's one completion contract through LiteLLM."""

    def __init__(self, config: LocalAIConfig) -> None:
        self._config = config
        self._route = litellm_model_route(config.provider, config.model)
        self.name = f"litellm:{config.provider}"
        self._usage_lock = Lock()
        self._usage = {
            "calls": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "model": self._route,
        }

    def usage_snapshot(self) -> dict[str, int | str | None]:
        with self._usage_lock:
            return dict(self._usage)

    def _record_usage(self, response: Any) -> None:
        usage = getattr(response, "usage", None)
        prompt = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion = int(getattr(usage, "completion_tokens", 0) or 0)
        total = int(getattr(usage, "total_tokens", 0) or prompt + completion)
        with self._usage_lock:
            self._usage["calls"] = int(self._usage["calls"]) + 1
            self._usage["prompt_tokens"] = int(self._usage["prompt_tokens"]) + prompt
            self._usage["completion_tokens"] = int(self._usage["completion_tokens"]) + completion
            self._usage["total_tokens"] = int(self._usage["total_tokens"]) + total

    def _request_options(self) -> dict[str, Any]:
        options: dict[str, Any] = {
            "model": self._route,
            "timeout": 60,
        }
        if self._config.api_key:
            options["api_key"] = self._config.api_key
        if self._config.base_url:
            options["api_base"] = str(self._config.base_url).rstrip("/")
        if self._config.api_version:
            options["api_version"] = self._config.api_version
        if self._route.startswith("vertex_ai/"):
            if self._config.project:
                options["vertex_project"] = self._config.project
            if self._config.region:
                options["vertex_location"] = self._config.region
        elif self._route.startswith("bedrock/") and self._config.region:
            options["aws_region_name"] = self._config.region
        return options

    def complete(self, prompt: str, system: str | None = None, max_tokens: int = 1024) -> str:
        try:
            from litellm import completion
        except ImportError as exc:
            raise LLMUnavailableError(
                "LiteLLM is not installed. Install the project dependencies before using AI providers."
            ) from exc

        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        response = completion(
            messages=messages,
            max_tokens=max_tokens,
            **self._request_options(),
        )
        self._record_usage(response)
        content = response.choices[0].message.content
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "".join(
                str(item.get("text", "")) if isinstance(item, dict) else str(item)
                for item in content
            )
        return "" if content is None else str(content)
