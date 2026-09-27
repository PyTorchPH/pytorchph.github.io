"""NullProvider — used in static mode to fail fast if an AI-only path is invoked."""

from __future__ import annotations

from .base import LLMProvider, LLMUnavailableError


class NullProvider(LLMProvider):
    name = "null"

    def complete(self, prompt: str, system: str | None = None, max_tokens: int = 1024) -> str:
        raise LLMUnavailableError(
            "LLM was invoked in static mode. This is a bug — static stages must not call the LLM."
        )
