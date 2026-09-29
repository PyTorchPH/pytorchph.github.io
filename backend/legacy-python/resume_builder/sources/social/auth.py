"""Shared auth primitives for social vendors that support real sign-in flows.

Three concerns live here, kept tiny on purpose:

1. ``LoginPrompt`` — abstract surface for asking the user a question. Console impl
   uses ``input()`` / ``getpass()``; tests can swap in a scripted prompt.

2. ``LoginChallenge`` — discriminated enum returned by a vendor mid-login when the
   server demands extra proof (TOTP / SMS / email / CAPTCHA). The orchestrator
   reads ``challenge.kind`` and ``challenge.question`` and routes to the prompt.

3. ``SessionStore`` — JSON-on-disk persistence for vendor cookies so a successful
   login carries across CLI invocations. Files are written 0600.

Vendors are NOT required to implement login. The ``LoginCapable`` mixin is opt-in.
"""

from __future__ import annotations

import getpass
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Protocol, runtime_checkable

log = logging.getLogger(__name__)


# ---- prompts ----


@runtime_checkable
class LoginPrompt(Protocol):
    def ask(self, question: str, *, secret: bool = False) -> str: ...


def masked_input(prompt: str, *, mask: str = "*") -> str:
    """Read a line from the controlling terminal, echoing ``mask`` per keystroke.

    Falls back to ``getpass`` (no visible echo) when stdin is not a real TTY —
    e.g. piped input, CI, or this codebase's own background-task runner. That
    keeps the function safe in scripts while giving real users the visual feedback
    of asterisks they expect.

    Supports backspace and Ctrl+C; ignores arrow keys and other control sequences.
    """
    if not sys.stdin.isatty():
        # Piped / redirected — getpass falls through to stdin.readline silently
        # and won't raise; visual masking is impossible without a terminal anyway.
        return getpass.getpass(prompt)

    if os.name == "nt":
        return _masked_input_windows(prompt, mask)
    return _masked_input_unix(prompt, mask)


def _masked_input_windows(prompt: str, mask: str) -> str:
    import msvcrt

    sys.stdout.write(prompt)
    sys.stdout.flush()
    buf: list[str] = []
    while True:
        ch = msvcrt.getwch()
        if ch in ("\r", "\n"):
            sys.stdout.write("\n")
            sys.stdout.flush()
            return "".join(buf)
        if ch == "\x03":  # Ctrl+C
            sys.stdout.write("\n")
            sys.stdout.flush()
            raise KeyboardInterrupt
        if ch == "\x08":  # Backspace
            if buf:
                buf.pop()
                sys.stdout.write("\b \b")
                sys.stdout.flush()
            continue
        if ch in ("\x00", "\xe0"):
            # Function / arrow key — swallow the second byte and ignore.
            msvcrt.getwch()
            continue
        if ch.isprintable():
            buf.append(ch)
            sys.stdout.write(mask)
            sys.stdout.flush()


def _masked_input_unix(prompt: str, mask: str) -> str:
    import termios
    import tty

    sys.stdout.write(prompt)
    sys.stdout.flush()
    fd = sys.stdin.fileno()
    old_attrs = termios.tcgetattr(fd)
    buf: list[str] = []
    try:
        tty.setraw(fd)
        while True:
            ch = sys.stdin.read(1)
            if ch in ("\r", "\n"):
                sys.stdout.write("\n")
                sys.stdout.flush()
                return "".join(buf)
            if ch == "\x03":  # Ctrl+C
                raise KeyboardInterrupt
            if ch in ("\x7f", "\x08"):  # Backspace / DEL
                if buf:
                    buf.pop()
                    sys.stdout.write("\b \b")
                    sys.stdout.flush()
                continue
            if ch == "\x1b":
                # Escape sequence (arrow keys etc.) — drain the next two bytes.
                sys.stdin.read(2)
                continue
            if ch.isprintable():
                buf.append(ch)
                sys.stdout.write(mask)
                sys.stdout.flush()
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_attrs)


class ConsolePrompt:
    """Default prompt: ``input()`` for visible answers, masked-input for secrets."""

    def ask(self, question: str, *, secret: bool = False) -> str:
        if secret:
            return masked_input(f"{question}: ")
        return input(f"{question}: ").strip()


@dataclass
class ScriptedPrompt:
    """Test double — pops answers in order. Raises if asked beyond the script."""

    answers: list[str]

    def ask(self, question: str, *, secret: bool = False) -> str:
        if not self.answers:
            raise AssertionError(f"ScriptedPrompt exhausted on: {question!r}")
        return self.answers.pop(0)


class FilePrompt:
    """File-coordinated prompt for environments without a usable stdin.

    Each ``ask`` writes a ``qN.txt`` file containing the question, then polls for
    a sibling ``qN.answer`` file the user creates with the response. Answer files
    are unlinked immediately after read so secrets don't linger.

    Layout (under ``base_dir``):
        q1.txt        # written by us; contains the question
        q1.answer     # written by the user; we read + delete it

    A ``status.txt`` file is updated at each step so monitors can tail it.
    """

    def __init__(self, base_dir: Path, *, timeout_s: float = 600.0, poll_s: float = 1.0) -> None:
        self._base = Path(base_dir)
        self._base.mkdir(parents=True, exist_ok=True)
        self._timeout = timeout_s
        self._poll = poll_s
        self._counter = 0

    def ask(self, question: str, *, secret: bool = False) -> str:
        import time

        self._counter += 1
        q_path = self._base / f"q{self._counter}.txt"
        q_temporary = self._base / f".q{self._counter}.txt.tmp"
        a_path = self._base / f"q{self._counter}.answer"
        meta = "[secret]\n" if secret else ""
        q_temporary.write_text(f"{meta}{question}\n", encoding="utf-8")
        q_temporary.replace(q_path)
        self._set_status(f"awaiting answer #{self._counter}: {question}")

        deadline = time.monotonic() + self._timeout
        while time.monotonic() < deadline:
            if a_path.exists():
                try:
                    answer = a_path.read_text(encoding="utf-8").strip()
                finally:
                    try:
                        a_path.unlink()
                    except OSError:
                        pass
                try:
                    q_path.unlink()
                except OSError:
                    pass
                self._set_status(f"received answer #{self._counter}")
                return answer
            time.sleep(self._poll)
        raise LoginError(f"FilePrompt timeout waiting for answer to: {question}")

    def _set_status(self, line: str) -> None:
        try:
            (self._base / "status.txt").write_text(line + "\n", encoding="utf-8")
        except OSError:
            pass


# ---- challenges ----


class ChallengeKind(str, Enum):
    TOTP = "totp"  # 6-digit code from authenticator app
    SMS = "sms"  # code sent to phone
    EMAIL = "email"  # code sent to email
    PUSH_APPROVAL = "push"  # tap on phone app — poll-based, no input
    CAPTCHA = "captcha"  # visual — unsupported on console
    UNKNOWN = "unknown"


@dataclass
class LoginChallenge:
    kind: ChallengeKind
    question: str
    state: dict = field(default_factory=dict)


@dataclass
class Credentials:
    username: str
    password: str


class LoginError(RuntimeError):
    """Login failed and cannot recover via console (e.g. CAPTCHA)."""


# ---- session store ----


def _default_session_dir() -> Path:
    base = os.environ.get("RESUME_BUILDER_CACHE") or (
        Path.home() / ".cache" / "resume-builder" / "social"
    )
    path = Path(base) / "sessions"
    path.mkdir(parents=True, exist_ok=True)
    return path


class SessionStore:
    """Per-vendor cookie persistence."""

    def __init__(self, base_dir: Path | None = None) -> None:
        self._dir = base_dir or _default_session_dir()
        self._dir.mkdir(parents=True, exist_ok=True)

    def path(self, vendor: str) -> Path:
        return self._dir / f"{vendor}.json"

    def load(self, vendor: str) -> dict[str, str]:
        p = self.path(vendor)
        if not p.exists():
            return {}
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("session load failed for %s: %s", vendor, exc)
            return {}

    def save(self, vendor: str, cookies: dict[str, str]) -> None:
        p = self.path(vendor)
        try:
            p.write_text(json.dumps(cookies, indent=2), encoding="utf-8")
            try:
                os.chmod(p, 0o600)
            except OSError:
                pass
        except OSError as exc:
            log.warning("session save failed for %s: %s", vendor, exc)

    def clear(self, vendor: str) -> None:
        p = self.path(vendor)
        if p.exists():
            try:
                p.unlink()
            except OSError as exc:
                log.warning("session clear failed for %s: %s", vendor, exc)

    def storage_state_path(self, vendor: str) -> Path:
        return self._dir / f"{vendor}.storage_state.json"

    def save_storage_state(self, vendor: str, state: dict) -> None:
        """Persist a Playwright ``storage_state`` blob for headless reuse."""
        p = self.storage_state_path(vendor)
        try:
            p.write_text(json.dumps(state, indent=2), encoding="utf-8")
            try:
                os.chmod(p, 0o600)
            except OSError:
                pass
        except OSError as exc:
            log.warning("storage_state save failed for %s: %s", vendor, exc)

    def load_storage_state(self, vendor: str) -> dict | None:
        p = self.storage_state_path(vendor)
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("storage_state load failed for %s: %s", vendor, exc)
            return None


# ---- mixin / capability marker ----


@runtime_checkable
class LoginCapable(Protocol):
    """Vendors implementing programmatic login satisfy this protocol."""

    name: str

    def login(self, creds: Credentials, prompt: LoginPrompt) -> dict[str, str]:
        """Return cookie dict on success. Raise ``LoginError`` on unrecoverable failure."""


# ---- layered cookie resolution ----


def _parse_cookie_string(raw: str) -> dict[str, str]:
    """Parse a `k1=v1; k2=v2` cookie header into a dict."""
    out: dict[str, str] = {}
    for chunk in (raw or "").split(";"):
        if "=" in chunk:
            k, v = chunk.strip().split("=", 1)
            if k.strip():
                out[k.strip()] = v.strip()
    return out


@dataclass(frozen=True)
class CurlExtract:
    url: str | None
    headers: dict[str, str]
    cookies: dict[str, str]


def parse_curl_command(curl_text: str) -> CurlExtract:
    """Parse a ``curl`` command as copied from Chrome DevTools Network panel.

    Handles bash-style line continuations (``\\``) and the cmd.exe variant (``^``).
    Pulls every ``-H``/``--header`` flag, the ``-b``/``--cookie`` flag, and any
    ``Cookie`` header into a single normalized dict. The URL is the last token
    that looks like an HTTP URL.
    """
    import shlex

    normalized = (
        curl_text.replace("\\\r\n", " ")
        .replace("\\\n", " ")
        .replace("^\r\n", " ")
        .replace("^\n", " ")
    )
    try:
        tokens = shlex.split(normalized, posix=True)
    except ValueError as exc:
        raise LoginError(f"could not parse curl command: {exc}") from exc

    headers: dict[str, str] = {}
    cookies: dict[str, str] = {}
    url: str | None = None
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok in ("-H", "--header") and i + 1 < len(tokens):
            value = tokens[i + 1]
            if ":" in value:
                name, body = value.split(":", 1)
                headers[name.strip()] = body.strip()
            i += 2
            continue
        if tok in ("-b", "--cookie") and i + 1 < len(tokens):
            cookies.update(_parse_cookie_string(tokens[i + 1]))
            i += 2
            continue
        if tok.startswith("http://") or tok.startswith("https://"):
            url = tok
        i += 1

    # Cookies in DevTools curls usually live inside the Cookie header.
    for hdr_name in ("Cookie", "cookie"):
        if hdr_name in headers:
            cookies.update(_parse_cookie_string(headers[hdr_name]))

    return CurlExtract(url=url, headers=headers, cookies=cookies)


# Env-var contract per vendor. Some carry the full cookie header (FB),
# others carry just the session token (LI/IG); both styles work because we
# pass the resulting dict through to requests.cookies.set.
_ENV_VAR: dict[str, str] = {
    "facebook": "FB_COOKIE",
    "linkedin": "LI_COOKIE",
    "instagram": "IG_COOKIE",
    "twitter": "TW_COOKIE",
}

# Single-key env vars: if value has no '=', treat as the named cookie's value.
_ENV_SINGLE_KEY: dict[str, str] = {
    "linkedin": "li_at",
    "instagram": "sessionid",
    "twitter": "auth_token",
}


def resolve_session_cookies(vendor: str, *, prefer_browser: str = "auto") -> dict[str, str]:
    """Return the best available cookie set for ``vendor`` without prompting.

    Resolution order:
      1. Explicit env var (``FB_COOKIE`` / ``LI_COOKIE`` / ``IG_COOKIE`` / ``TW_COOKIE``).
      2. Persistent session store (cookies from a prior ``resume-build login`` run).
      3. Local browser cookie jar via ``browser_cookie3`` (Chrome first, then auto).

    The browser path's success is cached into the session store so subsequent runs
    are fast and don't repeatedly hit DPAPI / keychain prompts.
    """

    env_name = _ENV_VAR.get(vendor)
    if env_name:
        raw = os.environ.get(env_name, "").strip()
        if raw:
            if "=" in raw:
                return _parse_cookie_string(raw)
            single = _ENV_SINGLE_KEY.get(vendor)
            if single:
                return {single: raw}

    store = SessionStore()
    saved = store.load(vendor)
    if saved:
        return saved

    # Last resort: import live from local browser. Lazy import keeps the optional
    # dep truly optional. Tests / CI can set RESUME_BUILDER_NO_BROWSER_COOKIES=1
    # to suppress the live scan.
    if os.environ.get("RESUME_BUILDER_NO_BROWSER_COOKIES"):
        return {}
    try:
        from .browser_cookies import import_cookies_report
    except Exception:  # noqa: BLE001
        return {}
    report = import_cookies_report(vendor, browser=prefer_browser)
    if report.ok:
        try:
            store.save(vendor, report.cookies)
        except Exception:  # noqa: BLE001 - cache write is best-effort
            pass
        log.info(
            "resolved %s cookies from local browser (%d entries)",
            vendor,
            len(report.cookies),
        )
        return report.cookies
    return {}
