"""Anthropic Claude provider."""

from __future__ import annotations

from .base import LLMProvider, LLMUnavailableError


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: str | None, model: str) -> None:
        if not api_key:
            raise LLMUnavailableError(
                "ANTHROPIC_API_KEY is not set. Either configure it or use --mode static."
            )
        try:
            import anthropic
        except ImportError as exc:
            raise LLMUnavailableError("`anthropic` package not installed.") from exc
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def complete(self, prompt: str, system: str | None = None, max_tokens: int = 1024) -> str:
        kwargs = {
            "model": self._model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system
        response = self._client.messages.create(**kwargs)
        return "".join(
            block.text for block in response.content if getattr(block, "type", "") == "text"
        )
