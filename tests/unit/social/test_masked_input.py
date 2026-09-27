"""masked_input: falls back to getpass when stdin is not a TTY (pipes, CI, tests)."""

from __future__ import annotations

import io
from unittest.mock import patch

from resume_builder.sources.social.auth import ConsolePrompt, masked_input


def test_masked_input_falls_back_to_getpass_when_no_tty(monkeypatch):
    """Non-TTY environments (tests, CI, piped input) cannot render asterisks —
    fall back to getpass which reads silently from stdin."""
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    with patch("resume_builder.sources.social.auth.getpass.getpass", return_value="secret") as gp:
        result = masked_input("pw> ")
    assert result == "secret"
    gp.assert_called_once_with("pw> ")


def test_console_prompt_routes_secret_to_masked_input(monkeypatch):
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    with patch(
        "resume_builder.sources.social.auth.getpass.getpass", return_value="hunter2"
    ) as gp:
        result = ConsolePrompt().ask("password", secret=True)
    assert result == "hunter2"
    assert "password" in gp.call_args.args[0]


def test_console_prompt_uses_plain_input_for_non_secrets(monkeypatch):
    with patch("builtins.input", return_value="  alice  ") as inp:
        result = ConsolePrompt().ask("username")
    assert result == "alice"
    inp.assert_called_once()


def test_windows_masked_input_echoes_asterisks(monkeypatch):
    """Unit-test the Windows getwch loop by stubbing msvcrt."""
    if not _has_msvcrt():
        import pytest

        pytest.skip("msvcrt is Windows-only")
    keystrokes = iter(["p", "a", "s", "s", "\r"])

    fake_msvcrt = type("M", (), {"getwch": staticmethod(lambda: next(keystrokes))})
    monkeypatch.setitem(__import__("sys").modules, "msvcrt", fake_msvcrt)
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr("os.name", "nt")

    captured = io.StringIO()
    monkeypatch.setattr("sys.stdout", captured)
    result = masked_input("pw: ", mask="*")
    assert result == "pass"
    assert captured.getvalue().count("*") == 4


def test_windows_masked_input_handles_backspace(monkeypatch):
    if not _has_msvcrt():
        import pytest

        pytest.skip("msvcrt is Windows-only")
    # Type "abx", backspace, "c", Enter -> "abc"
    keystrokes = iter(["a", "b", "x", "\x08", "c", "\r"])
    fake_msvcrt = type("M", (), {"getwch": staticmethod(lambda: next(keystrokes))})
    monkeypatch.setitem(__import__("sys").modules, "msvcrt", fake_msvcrt)
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr("os.name", "nt")

    captured = io.StringIO()
    monkeypatch.setattr("sys.stdout", captured)
    assert masked_input("pw: ") == "abc"
    # 3 asterisks (a, b, x), one backspace-erase sequence, one more asterisk (c)
    out = captured.getvalue()
    assert out.count("*") == 4
    assert "\b \b" in out


def _has_msvcrt() -> bool:
    try:
        import msvcrt  # noqa: F401

        return True
    except ImportError:
        return False
