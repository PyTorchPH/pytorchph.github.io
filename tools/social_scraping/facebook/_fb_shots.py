"""Screenshot each of the 12 verified OWN post permalinks so the agent can read the
real content with vision (DOM text extraction proved unreliable on logged-in SPA,
but per-page images differ — navigation works, so screenshots are faithful).

Reuses the URLs in out/data/facebook.json. Writes
out/screenshots/facebook/posts/post_NN.png. Scratch tool.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "pyproject.toml").exists())
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "legacy" / "python"))
from social_scraping.common.paths import FB_JSON as OUT, FB_SHOTS  # noqa: E402

SHOT_DIR = FB_SHOTS / "posts"


def _say(m: str) -> None:
    print(m, flush=True)


def main() -> int:
    from resume_builder.sources.social.auth import SessionStore
    from resume_builder.sources.social.headless_browser import PlaywrightSession

    data = json.loads(OUT.read_text(encoding="utf-8"))
    posts = data.get("posts", [])
    SHOT_DIR.mkdir(parents=True, exist_ok=True)

    store = SessionStore()
    with PlaywrightSession("facebook", headless=False, store=store) as page:
        page.set_viewport_size({"width": 1000, "height": 1300})
        for idx, p in enumerate(posts, 1):
            url = p["url"]
            try:
                page.goto(url, wait_until="domcontentloaded")
                # Let the post + first comments render; dismiss nothing.
                page.wait_for_timeout(3500)
                shot = SHOT_DIR / f"post_{idx:02d}.png"
                page.screenshot(path=str(shot), full_page=False)
                _say(f"[shots] {idx}/{len(posts)} -> {shot}  ({url[:60]})")
            except Exception as exc:  # noqa: BLE001
                _say(f"[shots] {idx}: failed {url} — {exc!r}")

    _say(f"[shots] DONE — screenshots in {SHOT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
