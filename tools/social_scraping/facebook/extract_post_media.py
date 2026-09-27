"""Extract the real image(s) embedded in each Facebook OWN post and save them
per-post, recording a post -> image mapping back into facebook.json.

The scraper that built facebook.json only kept text; this revisits each post
permalink, scopes to the post's own article (NOT the comment threads — comments
carry aria-label="Comment by…"/"Reply by…", proven by the author probe), grabs the
large photo CDN images, downloads them through the authenticated browser context,
and writes them to out/media/facebook/<post_id>/.

Run: python tools/social_scraping/facebook/extract_post_media.py
Requires a saved Facebook session (~/.cache/resume-builder/social/sessions/).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# --- bootstrap ---
ROOT = next(p for p in Path(__file__).resolve().parents if (p / "pyproject.toml").exists())
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "legacy" / "python"))
from social_scraping.common.paths import FB_JSON, FB_MEDIA  # noqa: E402

MIN_WIDTH = 400  # px — isolates the large post photo(s) from avatars (40px),
                 # reaction icons (296px), and link-preview thumbnails (~116px).

# EXTRACTION ONLY — separation of concerns: this dumps every large scontent image
# candidate found on the post permalink (sorted largest-first), with metadata. It
# deliberately does NOT try to decide which one is "the" post photo vs. a
# pinned/suggested image — that interpretation is a separate downstream phase.
# Size threshold only drops avatars/icons/link thumbnails.
_COLLECT_IMAGES = """
() => {
  const main = document.querySelector('div[role="main"]') || document.body;
  const seen = new Set();
  const out = [];
  main.querySelectorAll('img').forEach(im => {
    const src = im.currentSrc || im.src || '';
    if (!src || src.indexOf('scontent') === -1) return;
    if ((im.naturalWidth || 0) < %d) return;
    const a = im.closest('a');
    const href = a ? (a.getAttribute('href') || '') : '';
    const key = src.split('?')[0];
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ src: src, width: im.naturalWidth, height: im.naturalHeight,
               photo_link: /\\/photo(\\.php|\\/|\\?)/.test(href), href: href.slice(0, 120) });
  });
  out.sort((a, b) => (b.width * b.height) - (a.width * a.height));
  return out.slice(0, 12);  // all candidates (capped); interpretation happens elsewhere
}
""" % MIN_WIDTH

_EXT_BY_TYPE = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
    "image/webp": "webp", "image/gif": "gif",
}


def _say(m: str) -> None:
    print(m, flush=True)


def _ext_for(resp, src: str) -> str:
    ctype = (resp.headers.get("content-type", "") if resp else "").split(";")[0].strip().lower()
    if ctype in _EXT_BY_TYPE:
        return _EXT_BY_TYPE[ctype]
    tail = src.split("?")[0].rsplit(".", 1)[-1].lower()
    return tail if tail in ("jpg", "jpeg", "png", "webp", "gif") else "jpg"


def main() -> int:
    from resume_builder.sources.social.auth import SessionStore
    from resume_builder.sources.social.headless_browser import PlaywrightSession

    data = json.loads(FB_JSON.read_text(encoding="utf-8"))
    posts = data.get("posts", [])
    if not posts:
        _say(f"[media] no posts in {FB_JSON}")
        return 2

    store = SessionStore()
    total_imgs = 0
    with PlaywrightSession("facebook", headless=False, store=store) as page:
        for idx, post in enumerate(posts, 1):
            url, post_id = post.get("url", ""), post.get("post_id", f"post{idx}")
            if not url:
                continue
            try:
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=45000)
                except Exception:  # noqa: BLE001 — one lenient retry on slow loads
                    page.goto(url, wait_until="commit", timeout=45000)
                page.wait_for_timeout(2500)
                # Accumulate candidates across a few scroll positions so lazy-loaded
                # post images get a chance to decode (more raw candidates = better for
                # the separate interpretation phase).
                by_url: dict[str, dict] = {}
                for _ in range(4):
                    for im in page.evaluate(_COLLECT_IMAGES) or []:
                        by_url.setdefault(im["src"].split("?")[0], im)
                    page.evaluate("window.scrollBy(0, 500)")
                    page.wait_for_timeout(1500)
                imgs = sorted(by_url.values(), key=lambda m: -(m["width"] * m["height"]))[:12]
            except Exception as exc:  # noqa: BLE001
                _say(f"[media] {idx}/{len(posts)} {post_id}: page error {exc!r}")
                post["media"] = []
                continue

            media = []
            dest_dir = FB_MEDIA / post_id
            for i, im in enumerate(imgs, 1):
                src = im["src"]
                try:
                    resp = page.request.get(src)
                    body = resp.body()
                    ext = _ext_for(resp, src)
                    dest_dir.mkdir(parents=True, exist_ok=True)
                    fname = f"img_{i:02d}.{ext}"
                    (dest_dir / fname).write_bytes(body)
                    rel = (dest_dir / fname).relative_to(ROOT).as_posix()
                    media.append({"url": src, "file": rel, "width": im["width"],
                                  "height": im["height"], "photo_link": im.get("photo_link", False),
                                  "href": im.get("href", "")})
                    total_imgs += 1
                except Exception as exc:  # noqa: BLE001
                    _say(f"[media]   download failed for img {i} of {post_id}: {exc!r}")
            post["media"] = media
            _say(f"[media] {idx}/{len(posts)} {post_id}: {len(media)} image(s)"
                 + (f" -> out/media/facebook/{post_id}/" if media else ""))

    FB_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    _say(f"\n[media] DONE — {total_imgs} images across {len(posts)} posts; "
         f"mapping written to {FB_JSON.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
