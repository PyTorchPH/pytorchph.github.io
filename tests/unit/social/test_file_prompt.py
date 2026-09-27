"""FilePrompt: question/answer files coordinate Q&A across processes."""

from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest

from resume_builder.sources.social.auth import FilePrompt, LoginError


def test_file_prompt_round_trip(tmp_path: Path):
    prompt = FilePrompt(tmp_path, timeout_s=5.0, poll_s=0.05)
    answers: list[str] = []

    def asker():
        answers.append(prompt.ask("what is your name?"))

    t = threading.Thread(target=asker)
    t.start()
    # wait for question file
    q1 = tmp_path / "q1.txt"
    for _ in range(50):
        if q1.exists():
            break
        time.sleep(0.05)
    assert q1.exists()
    assert "what is your name?" in q1.read_text(encoding="utf-8")

    (tmp_path / "q1.answer").write_text("alice", encoding="utf-8")
    t.join(timeout=5.0)
    assert answers == ["alice"]
    assert not q1.exists()
    assert not (tmp_path / "q1.answer").exists()


def test_file_prompt_marks_secret(tmp_path: Path):
    prompt = FilePrompt(tmp_path, timeout_s=5.0, poll_s=0.05)

    def asker():
        prompt.ask("password", secret=True)

    t = threading.Thread(target=asker)
    t.start()
    q1 = tmp_path / "q1.txt"
    for _ in range(50):
        if q1.exists():
            break
        time.sleep(0.05)
    assert "[secret]" in q1.read_text(encoding="utf-8")
    (tmp_path / "q1.answer").write_text("secret123", encoding="utf-8")
    t.join(timeout=5.0)


def test_file_prompt_timeout(tmp_path: Path):
    prompt = FilePrompt(tmp_path, timeout_s=0.3, poll_s=0.05)
    with pytest.raises(LoginError, match="timeout"):
        prompt.ask("never answered")


def test_file_prompt_writes_status(tmp_path: Path):
    prompt = FilePrompt(tmp_path, timeout_s=5.0, poll_s=0.05)

    def asker():
        prompt.ask("first?")

    t = threading.Thread(target=asker)
    t.start()
    status = tmp_path / "status.txt"
    for _ in range(50):
        if status.exists():
            break
        time.sleep(0.05)
    assert "awaiting answer #1" in status.read_text(encoding="utf-8")
    (tmp_path / "q1.answer").write_text("ok", encoding="utf-8")
    t.join(timeout=5.0)
    assert "received answer #1" in status.read_text(encoding="utf-8")
