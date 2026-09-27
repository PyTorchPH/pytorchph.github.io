from __future__ import annotations

from types import SimpleNamespace

from resume_builder.web import shared_browser


def test_existing_cdp_browser_is_reused(monkeypatch):
    monkeypatch.setattr(shared_browser, "is_ready", lambda **_kwargs: True)
    monkeypatch.setattr(
        shared_browser.subprocess,
        "Popen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("must not launch Chrome")),
    )

    result = shared_browser.ensure_shared_browser()

    assert result == {"cdp_url": "http://127.0.0.1:9222", "started": False, "pid": None}


def test_open_tab_starts_one_shared_browser_then_uses_cdp_target(monkeypatch, tmp_path):
    readiness = iter([False, False, True])
    process = SimpleNamespace(pid=321, poll=lambda: None)
    opened = []

    class _Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"id": "TARGET_1", "url": "https://example.com/sign-in"}

    monkeypatch.setenv("JOB_FINDER_CHROME_PROFILE", str(tmp_path / "profile"))
    monkeypatch.setattr(shared_browser, "_PROCESS", None)
    monkeypatch.setattr(shared_browser, "_browser_executable", lambda: "/brave")
    monkeypatch.setattr(shared_browser, "is_ready", lambda **_kwargs: next(readiness))
    monkeypatch.setattr(
        shared_browser.subprocess,
        "Popen",
        lambda command, **kwargs: opened.append((command, kwargs)) or process,
    )
    monkeypatch.setattr(shared_browser.requests, "put", lambda url, timeout: _Response())

    result = shared_browser.open_tab("https://example.com/sign-in")

    assert result == {"target_id": "TARGET_1", "url": "https://example.com/sign-in"}
    assert len(opened) == 1
    assert "--remote-debugging-address=127.0.0.1" in opened[0][0]
    assert "--remote-debugging-port=9222" in opened[0][0]
    assert any(argument.startswith("--user-data-dir=") for argument in opened[0][0])
    assert opened[0][1]["start_new_session"] is True


def test_browser_executable_prefers_brave(monkeypatch):
    monkeypatch.delenv("JOB_FINDER_BROWSER_EXECUTABLE", raising=False)
    monkeypatch.delenv("JOB_FINDER_CHROME_EXECUTABLE", raising=False)
    monkeypatch.setattr(
        shared_browser.shutil,
        "which",
        lambda name: f"/usr/bin/{name}" if name in {"brave-browser-stable", "google-chrome"} else None,
    )

    assert shared_browser._browser_executable() == "/usr/bin/brave-browser-stable"
