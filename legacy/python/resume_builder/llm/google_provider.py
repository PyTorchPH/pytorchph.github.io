"""Google Gemini implementation of the provider-neutral LLM boundary."""

from __future__ import annotations

from typing import TypeVar

import requests
from pydantic import BaseModel

from .base import LLMProvider, LLMUnavailableError, _parse_json_into

T = TypeVar("T", bound=BaseModel)


class GoogleProvider(LLMProvider):
    """Call Gemini through REST without leaking the API key into URLs or artifacts."""

    name = "google"

    def __init__(
        self,
        api_key: str | None,
        model: str = "gemini-3.1-pro-preview",
        *,
        base_url: str = "https://generativelanguage.googleapis.com/v1beta",
        timeout_seconds: float = 60.0,
        session: requests.Session | None = None,
    ) -> None:
        if not api_key:
            raise LLMUnavailableError("GOOGLE_API_KEY or GEMINI_API_KEY is not set.")
        self._api_key = api_key
        self._model = model.strip()
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._session = session or requests.Session()

    def complete(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 1024,
    ) -> str:
        return self._request(
            prompt,
            system=system,
            max_tokens=max_tokens,
            response_schema=None,
        )

    def structured(
        self,
        prompt: str,
        schema: type[T],
        system: str | None = None,
        max_tokens: int = 2048,
    ) -> T:
        raw = self._request(
            prompt,
            system=system,
            max_tokens=max_tokens,
            response_schema=_google_json_schema(schema.model_json_schema()),
        )
        return _parse_json_into(raw, schema)

    def _request(
        self,
        prompt: str,
        *,
        system: str | None,
        max_tokens: int,
        response_schema: dict | None,
    ) -> str:
        payload: dict = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "candidateCount": 1,
                "maxOutputTokens": max_tokens,
                "temperature": 0.1,
            },
        }
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}
        if response_schema is not None:
            payload["generationConfig"].update(
                {
                    "responseMimeType": "application/json",
                    "responseJsonSchema": response_schema,
                }
            )
        try:
            response = self._session.post(
                f"{self._base_url}/models/{self._model}:generateContent",
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": self._api_key,
                },
                json=payload,
                timeout=self._timeout_seconds,
            )
        except requests.RequestException as exc:
            raise LLMUnavailableError("Google model request could not be completed.") from exc
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            # Do not include response headers or request details: either can contain secrets.
            raise LLMUnavailableError(
                f"Google model request failed with HTTP {response.status_code}"
            ) from exc
        body = response.json()
        candidates = body.get("candidates") or []
        if not candidates:
            reason = (body.get("promptFeedback") or {}).get("blockReason", "no candidate")
            raise LLMUnavailableError(f"Google model returned no answer: {reason}")
        parts = ((candidates[0].get("content") or {}).get("parts") or [])
        text = "".join(str(part.get("text", "")) for part in parts).strip()
        if not text:
            raise LLMUnavailableError("Google model returned an empty answer.")
        return text


def _google_json_schema(value):
    """Translate Pydantic JSON Schema to Gemini's documented supported subset."""
    if isinstance(value, list):
        return [_google_json_schema(item) for item in value]
    if not isinstance(value, dict):
        return value
    clean = {}
    for key, item in value.items():
        if key == "const":
            clean["enum"] = [_google_json_schema(item)]
            continue
        if key in {"default", "examples"}:
            continue
        clean[key] = _google_json_schema(item)
    return clean
