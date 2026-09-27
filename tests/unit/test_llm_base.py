from __future__ import annotations

import pytest
from pydantic import BaseModel

from resume_builder.llm.base import LLMProvider, _parse_json_into
from resume_builder.llm.null_provider import NullProvider
from resume_builder.llm import LLMUnavailableError


class _Demo(BaseModel):
    a: int
    b: str


def test_parse_json_fenced():
    raw = "Here you go:\n```json\n{\"a\": 1, \"b\": \"x\"}\n```"
    obj = _parse_json_into(raw, _Demo)
    assert obj.a == 1 and obj.b == "x"


def test_parse_json_unfenced_with_prose():
    raw = "Sure: {\"a\": 2, \"b\": \"y\"} hope that helps"
    obj = _parse_json_into(raw, _Demo)
    assert obj.a == 2 and obj.b == "y"


def test_null_provider_raises():
    with pytest.raises(LLMUnavailableError):
        NullProvider().complete("hi")


class _FakeLLM(LLMProvider):
    name = "fake"

    def __init__(self, response: str) -> None:
        self._response = response

    def complete(self, prompt, system=None, max_tokens=1024):
        return self._response


def test_structured_default_uses_complete():
    llm = _FakeLLM('{"a": 5, "b": "ok"}')
    result = llm.structured("anything", schema=_Demo)
    assert result.a == 5 and result.b == "ok"
