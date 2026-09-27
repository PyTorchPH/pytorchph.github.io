"""Provider-agnostic LLM interface.

Every concrete provider exposes the same two surfaces:
- `complete(prompt, system=...)` for free-form text generation.
- `structured(prompt, schema, system=...)` for typed object output.

The pipeline stages depend only on this ABC; swapping providers is a registry-level
concern, not a stage-level one.
"""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from typing import TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class LLMUnavailableError(RuntimeError):
    """Raised when LLM is invoked but is not configured (e.g. static mode misuse)."""


class LLMProvider(ABC):
    """Abstract LLM provider. Concrete subclasses live alongside in this package."""

    name: str = "abstract"

    def usage_snapshot(self) -> dict[str, int | str | None]:
        """Provider-reported usage for observability; never estimate missing token counts."""
        return {
            "calls": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "model": None,
        }

    @abstractmethod
    def complete(self, prompt: str, system: str | None = None, max_tokens: int = 1024) -> str:
        """Return a single text completion."""

    def structured(
        self,
        prompt: str,
        schema: type[T],
        system: str | None = None,
        max_tokens: int = 2048,
    ) -> T:
        """Default implementation: ask for JSON, parse into pydantic.

        Concrete providers can override with native tool-use/structured-output APIs.
        """
        schema_json = json.dumps(schema.model_json_schema(), indent=2)
        instruction = (
            "Respond with a single JSON object that conforms exactly to this JSON Schema. "
            "No prose, no markdown fences, no commentary — JSON only.\n\n"
            f"Schema:\n{schema_json}"
        )
        full_system = f"{system}\n\n{instruction}" if system else instruction
        raw = self.complete(prompt, system=full_system, max_tokens=max_tokens)
        return _parse_json_into(raw, schema)


def _parse_json_into(raw: str, schema: type[T]) -> T:
    """Tolerant JSON parser — handles ```json fences and stray prose around the object."""
    candidate = raw.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", candidate, re.DOTALL)
    if fence:
        candidate = fence.group(1)
    else:
        first = candidate.find("{")
        last = candidate.rfind("}")
        if first != -1 and last != -1 and last > first:
            candidate = candidate[first : last + 1]
    return schema.model_validate_json(candidate)
