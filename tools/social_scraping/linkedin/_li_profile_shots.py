"""Screenshot the logged-in user's LinkedIn profile + each resume-relevant detail
section so the agent can read them with vision (the curl-based LI vendor only sees
activity posts, not profile sections).

Resolves the handle via /in/me/ (redirects to the owner's vanity URL), then captures:
  - the main profile (scrolled in segments)
  - dedicated detail pages: experience, education, certifications, honors, projects,
    skills, volunteering, courses

Writes out/li_profile/*.png + out/li_profile/handle.txt. Scratch tool.
"""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "pyproject.toml").exists())
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "legacy" / "python"))
from social_scraping.common.paths import LI_SHOTS as SHOT_DIR  # noqa: E402

SEG_DIR = SHOT_DIR / "segments"
DETAILS_DIR = SHOT_DIR / "details"

DETAIL_SECTIONS = [
    "experience",
    "education",
    "certifications",
    "honors",
    "projects",
    "skills",
    "volunteering-experiences",
    "courses",
]


def _say(m: str) -> None:
    print(m, flush=True)


def main() -> int:
    from resume_builder.sources.social.auth import SessionStore
    from resume_builder.sources.social.headless_browser import PlaywrightSession

    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    SEG_DIR.mkdir(parents=True, exist_ok=True)
    DETAILS_DIR.mkdir(parents=True, exist_ok=True)
    store = SessionStore()

    with PlaywrightSession("linkedin", headless=False, store=store) as page:
        page.set_viewport_size({"width": 1100, "height": 1400})

        # Resolve the owner's vanity handle.
        _say("[li] resolving handle via /in/me/ ...")
        page.goto("https://www.linkedin.com/in/me/", wait_until="domcontentloaded")
        page.wait_for_timeout(4000)
        resolved = page.url
        path = urlparse(resolved).path  # e.g. /in/your-handle-123/
        handle = ""
        parts = [s for s in path.split("/") if s]
        if len(parts) >= 2 and parts[0] == "in":
            handle = parts[1]
        (SHOT_DIR / "handle.txt").write_text(f"{handle}\n{resolved}\n", encoding="utf-8")
        _say(f"[li] resolved handle={handle!r}  url={resolved}")

        if not handle:
            _say("[li] could not resolve handle — screenshotting whatever loaded")
            page.screenshot(path=str(SHOT_DIR / "profile_unknown.png"))
            return 1

        base = f"https://www.linkedin.com/in/{handle}"

        # Main profile: scroll in segments and screenshot each viewport.
        _say("[li] capturing main profile (segmented scroll)...")
        page.goto(base + "/", wait_until="domcontentloaded")
        page.wait_for_timeout(4000)
        for seg in range(6):
            page.screenshot(path=str(SEG_DIR / f"profile_seg{seg:02d}.png"))
            page.evaluate("window.scrollBy(0, window.innerHeight * 0.85)")
            page.wait_for_timeout(1500)

        # Dedicated detail pages — fuller lists, cleaner to read.
        for sec in DETAIL_SECTIONS:
            url = f"{base}/details/{sec}/"
            try:
                page.goto(url, wait_until="domcontentloaded")
                page.wait_for_timeout(3500)
                sec_dir = DETAILS_DIR / sec
                sec_dir.mkdir(parents=True, exist_ok=True)
                # capture up to 3 segments per section in case the list is long
                for seg in range(3):
                    shot = sec_dir / f"{seg:02d}.png"
                    page.screenshot(path=str(shot))
                    page.evaluate(
                        "(() => { const b=document.body.scrollHeight; window.scrollBy(0, window.innerHeight*0.85); return b; })()"
                    )
                    page.wait_for_timeout(1200)
                _say(f"[li] captured detail/{sec}")
            except Exception as exc:  # noqa: BLE001
                _say(f"[li] detail/{sec} failed: {exc!r}")

    _say(f"[li] DONE — screenshots in {SHOT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
