"""OpenAI provider (optional — install with `pip install 'resume-build-chopper[openai]'`)."""

from __future__ import annotations

from .base import LLMProvider, LLMUnavailableError


class OpenAIProvider(LLMProvider):
    """OpenAI-compatible HTTP provider for cloud or locally hosted model APIs."""

    name = "openai-compatible"

    def __init__(
        self,
        api_key: str | None,
        model: str,
        base_url: str | None = None,
    ) -> None:
        normalized_base = (base_url or "https://api.openai.com/v1").rstrip("/")
        if not api_key and "api.openai.com" in normalized_base:
            raise LLMUnavailableError("RESUME_LLM_API_KEY or OPENAI_API_KEY is not set.")
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise LLMUnavailableError(
                "`openai` package not installed. Install with `pip install 'resume-build-chopper[openai]'`."
            ) from exc
        self._client = OpenAI(
            api_key=api_key or "local-api",
            base_url=normalized_base,
        )
        self._model = model

    def complete(self, prompt: str, system: str | None = None, max_tokens: int = 1024) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        response = self._client.chat.completions.create(
            model=self._model,
            messages=messages,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content or ""
