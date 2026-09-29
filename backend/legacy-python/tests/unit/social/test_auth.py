"""Auth primitives: session store round-trip + ScriptedPrompt behavior."""

from __future__ import annotations

from pathlib import Path

import pytest

from resume_builder.sources.social.auth import (
    ConsolePrompt,
    Credentials,
    LoginError,
    ScriptedPrompt,
    SessionStore,
)


def test_session_store_round_trips(tmp_path: Path):
    store = SessionStore(base_dir=tmp_path)
    store.save("twitter", {"auth_token": "abc", "ct0": "xyz"})

    loaded = store.load("twitter")
    assert loaded == {"auth_token": "abc", "ct0": "xyz"}

    store.clear("twitter")
    assert store.load("twitter") == {}


def test_session_store_missing_file_returns_empty(tmp_path: Path):
    store = SessionStore(base_dir=tmp_path)
    assert store.load("ghost") == {}


def test_scripted_prompt_pops_in_order():
    prompt = ScriptedPrompt(["alice", "secret123", "456789"])
    assert prompt.ask("username") == "alice"
    assert prompt.ask("password", secret=True) == "secret123"
    assert prompt.ask("totp") == "456789"


def test_scripted_prompt_raises_when_exhausted():
    prompt = ScriptedPrompt([])
    with pytest.raises(AssertionError):
        prompt.ask("anything")


def test_credentials_is_a_dataclass():
    c = Credentials(username="u", password="p")
    assert c.username == "u"
    assert c.password == "p"


def test_login_error_is_a_runtime_error():
    assert issubclass(LoginError, RuntimeError)


def test_console_prompt_satisfies_protocol():
    """ConsolePrompt should structurally match the LoginPrompt protocol."""
    from resume_builder.sources.social.auth import LoginPrompt

    assert isinstance(ConsolePrompt(), LoginPrompt)
