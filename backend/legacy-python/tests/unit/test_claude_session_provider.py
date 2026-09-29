from __future__ import annotations

import io
from pathlib import Path

from pydantic import BaseModel

from resume_builder.llm import ClaudeSessionProvider


class _Demo(BaseModel):
    a: int
    b: str


def test_complete_reads_until_sentinel(tmp_path: Path):
    response_text = "Sure, here's the JSON:\n{\"a\": 7, \"b\": \"hi\"}"
    stream_in = io.StringIO(response_text + "\n===END===\nignored after sentinel\n")
    stream_out = io.StringIO()
    provider = ClaudeSessionProvider(
        session_dir=tmp_path, stream_in=stream_in, stream_out=stream_out
    )

    result = provider.complete("test prompt", system="You are a resume strategist. RoleSpec.")

    assert result.strip().endswith('"b": "hi"}')
    out = stream_out.getvalue()
    assert "LLM CALL #1" in out
    assert "test prompt" in out
    assert "===END===" in out  # banner mentions sentinel

    prompts = list((tmp_path / "prompts").iterdir())
    responses = list((tmp_path / "responses").iterdir())
    assert len(prompts) == 1 and len(responses) == 1
    assert "role-picker" in prompts[0].name


def test_complete_then_structured_parses_json(tmp_path: Path):
    response_text = '{"a": 3, "b": "ok"}'
    stream_in = io.StringIO(response_text + "\n===END===\n")
    stream_out = io.StringIO()
    provider = ClaudeSessionProvider(
        session_dir=tmp_path, stream_in=stream_in, stream_out=stream_out
    )

    parsed = provider.structured("anything", schema=_Demo)
    assert parsed.a == 3
    assert parsed.b == "ok"


def test_call_counter_persists_across_provider_instances(tmp_path: Path):
    # First call.
    p1 = ClaudeSessionProvider(
        session_dir=tmp_path,
        stream_in=io.StringIO("response one\n===END===\n"),
        stream_out=io.StringIO(),
    )
    p1.complete("prompt one")
    # Fresh provider on the same dir should auto-increment.
    p2 = ClaudeSessionProvider(
        session_dir=tmp_path,
        stream_in=io.StringIO("response two\n===END===\n"),
        stream_out=io.StringIO(),
    )
    p2.complete("prompt two")
    files = sorted((tmp_path / "prompts").iterdir())
    assert [f.name[:2] for f in files] == ["01", "02"]


def test_resume_review_stage_name(tmp_path: Path):
    stream_in = io.StringIO("# Critical Issues\n- x\n===END===\n")
    stream_out = io.StringIO()
    provider = ClaudeSessionProvider(
        session_dir=tmp_path, stream_in=stream_in, stream_out=stream_out
    )

    provider.complete("resume text", system="You are a Resume Review Orchestrator.")

    prompts = list((tmp_path / "prompts").iterdir())
    assert len(prompts) == 1
    assert "resume-review" in prompts[0].name
