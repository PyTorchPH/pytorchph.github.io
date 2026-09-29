"""Ephemeral provider that routes LLM calls through an interactive chat session.

When `complete()` is invoked, this provider:
1. Persists the system + prompt to a numbered file under `session_dir/prompts/`.
2. Prints a clearly-delimited block to stdout for easy copy-paste into a chat with Claude.
3. Reads the user-pasted response from stdin until a sentinel line is seen.
4. Persists the response under `session_dir/responses/` for later replay/debugging.

No network, no API key. Intended as a same-code stand-in so the AI pipeline can be
exercised end-to-end without provisioning a real LLM credential.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import TextIO

from .base import LLMProvider

_END_SENTINEL = "===END==="
_BANNER_TOP = "╔════════════════════════════════════════════════════════════╗"
_BANNER_BOT = "╚════════════════════════════════════════════════════════════╝"


class ClaudeSessionProvider(LLMProvider):
    name = "claude-session"

    def __init__(
        self,
        session_dir: Path | str = "./session",
        stream_in: TextIO | None = None,
        stream_out: TextIO | None = None,
    ) -> None:
        self._session_dir = Path(session_dir)
        (self._session_dir / "prompts").mkdir(parents=True, exist_ok=True)
        (self._session_dir / "responses").mkdir(parents=True, exist_ok=True)
        self._stream_in = stream_in or sys.stdin
        self._stream_out = stream_out or sys.stdout
        self._call_index = self._next_index()

    def _next_index(self) -> int:
        existing = list((self._session_dir / "prompts").glob("*.txt"))
        return len(existing) + 1

    def complete(self, prompt: str, system: str | None = None, max_tokens: int = 1024) -> str:
        idx = self._call_index
        self._call_index += 1
        stage = _infer_stage(system or "")
        prompt_path = self._session_dir / "prompts" / f"{idx:02d}-{stage}.txt"
        response_path = self._session_dir / "responses" / f"{idx:02d}-{stage}.txt"

        prompt_payload = _format_payload(system, prompt)
        prompt_path.write_text(prompt_payload, encoding="utf-8")

        self._print_block(idx, stage, prompt_path, prompt_payload)
        response = self._read_until_sentinel()
        response_path.write_text(response, encoding="utf-8")
        self._stream_out.write(f"[ok] response captured ({len(response)} chars) -> {response_path}\n")
        self._stream_out.flush()
        return response

    def _print_block(self, idx: int, stage: str, prompt_path: Path, payload: str) -> None:
        out = self._stream_out
        out.write("\n")
        out.write(_BANNER_TOP + "\n")
        out.write(f"║ LLM CALL #{idx} ({stage}) — copy block into Claude chat.   ║\n")
        out.write(f"║ Paste reply below, end with a line: {_END_SENTINEL}            ║\n")
        out.write(f"║ Prompt saved to: {prompt_path}\n")
        out.write(_BANNER_BOT + "\n")
        out.write(payload)
        out.write("\n--- END OF BLOCK ---\n")
        out.flush()

    def _read_until_sentinel(self) -> str:
        lines: list[str] = []
        for line in self._stream_in:
            stripped = line.rstrip("\r\n")
            if stripped.strip() == _END_SENTINEL:
                break
            lines.append(line.rstrip("\r\n"))
        return "\n".join(lines).strip()


def _format_payload(system: str | None, prompt: str) -> str:
    parts = []
    if system:
        parts.append("--- SYSTEM ---")
        parts.append(system)
    parts.append("--- PROMPT ---")
    parts.append(prompt)
    return "\n".join(parts)


def _infer_stage(system: str) -> str:
    s = system.lower()
    if "resume strategist" in s and "rolespec" in s:
        return "role-picker"
    if "filter" in s and "github" in s:
        return "extractor"
    if "resume review orchestrator" in s:
        return "resume-review"
    if "resume writer" in s:
        return "synth"
    return "llm-call"


def build_from_env(session_dir: str | None = None) -> ClaudeSessionProvider:
    """Factory helper that honours `RESUME_SESSION_DIR` if present."""
    target = session_dir or os.environ.get("RESUME_SESSION_DIR") or "./session"
    return ClaudeSessionProvider(session_dir=target)
