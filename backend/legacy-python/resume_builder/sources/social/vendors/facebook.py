"""Facebook handler.

Two scrape paths, picked at runtime:

1. **Headless Playwright** using the ``storage_state.json`` written during sign-in.
   Hits real ``www.facebook.com`` URLs as the authenticated user — full React feed,
   not the mobile-basic fallback. This is the path the user explicitly chose when
   they ran ``resume-build login``.

2. **mbasic.facebook.com via curl** with cookies — kept as a fallback for users who
   only have cookies (env var / DevTools paste) and never ran the Playwright sign-in.

Vendors return ``[]`` cleanly when neither path is usable.
"""

from __future__ import annotations

import logging
import re
from typing import Iterable

from ..auth import Credentials, LoginError, LoginPrompt, SessionStore, resolve_session_cookies
from ..base import SocialVendor
from ..headless_browser import (
    NoStoredSessionError,
    PlaywrightSession,
    scroll_collect,
)
from ..playwright_step import step_limit_from_env, step_through_articles
from ..http import HttpClient
from ..models import SocialMention, SocialPost

log = logging.getLogger(__name__)

_BASE = "https://mbasic.facebook.com"
# Facebook wraps BOTH posts and individual comments in ``div[role="article"]``,
# with comment articles nested inside the post article. Excluding any article that
# sits inside another article keeps only top-level posts — so the scraper never
# walks into (or highlights) the comment section.
_POST_ARTICLE_SELECTOR = 'div[role="article"]:not([role="article"] [role="article"])'
_POST_LINK_RE = re.compile(r'href="(/story\.php\?story_fbid=\d+[^"]*)"')
_TEXT_BLOCK_RE = re.compile(r"<p>(.*?)</p>", re.IGNORECASE | re.DOTALL)
_TAG_STRIP_RE = re.compile(r"<[^>]+>")
_AUTHOR_RE = re.compile(r"<strong[^>]*>([^<]+)</strong>")


# Read the post body only — clone the article and drop nested comment articles
# before reading innerText. Also drop buttons, toolbars, and SVGs to avoid
# accidentally scraping "Like", "Reply", or "Share" labels that clutter the text.
_POST_BODY_TEXT_JS = """
el => {
  const clone = el.cloneNode(true);
  // Remove nested comments but NOT shared posts.
  // Comments usually have aria-label="Comment by..." or similar. 
  // By checking the label, we preserve shared posts which might also use role="article".
  clone.querySelectorAll('[role="article"]').forEach(n => {
    const label = n.getAttribute('aria-label') || '';
    if (/\\s*comment by/i.test(label) || /\\s*reply by/i.test(label)) {
      n.remove();
    }
  });
  // Remove action bars and buttons (Like, Reply, Share)
  clone.querySelectorAll('[role="button"], [role="toolbar"], form, svg, [data-visualcompletion="ignore"]').forEach(n => n.remove());
  return (clone.innerText || '').trim();
}
"""

# Classify an article. Facebook tags comment articles with aria-label="Comment by …"
# — the authoritative signal — so any such article is a comment. As a fallback, an
# article whose only permalink carries comment_id (and has no clean post link) is also
# a comment. Articles with no recognizable links are kept as posts rather than dropped.
_POST_HREF_JS = """
el => {
  const label = el.getAttribute('aria-label') || '';
  const labelledComment = /^\\s*comment by/i.test(label);
  const links = Array.from(el.querySelectorAll(
    'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]'));
  const post = links.find(a => !a.href.includes('comment_id'));
  const hasCommentLink = links.some(a => a.href.includes('comment_id'));
  return {
    href: post ? post.href : '',
    isComment: labelledComment || (!post && hasCommentLink),
  };
}
"""


# Modern FB profile timelines DON'T wrap posts in role="article" — only comments are
# articles (verified live: every role="article" was a comment or an empty shell, and
# real captions lived in plain divs). So we detect posts by their permalink/timestamp
# anchor instead: it carries the __cft__ token plus a post id. Each post is keyed by
# that id (album pcb id, pfbid, story_fbid, or /posts/<id>), we climb to the post
# "unit" (last ancestor holding exactly one post id — this collapses album photos that
# each carry their own fbid), and read the caption from the longest div[dir="auto"]
# block inside, skipping comment subtrees.
_EXTRACT_OWN_POSTS_JS = r"""
() => {
  const postId = (href) => {
    href = href || '';
    let m;
    if ((m = href.match(/set=pcb\.(\d+)/))) return 'pcb' + m[1];
    if ((m = href.match(/story_fbid=(\d+)/))) return 'sf' + m[1];
    if ((m = href.match(/\/posts\/(pfbid\w+|\d+)/))) return 'po' + m[1];
    if ((m = href.match(/\/permalink\/(\d+)/))) return 'pl' + m[1];
    return null;  // bare photo fbid / profile / friend links are not post markers
  };
  const idsIn = (el) => {
    const s = new Set();
    el.querySelectorAll('a[href*="__cft__"]').forEach(a => {
      const id = postId(a.getAttribute('href')); if (id) s.add(id);
    });
    return s;
  };
  const anchors = Array.from(document.querySelectorAll('a[href*="__cft__"]'))
    .map(a => ({ a, id: postId(a.getAttribute('href')) })).filter(x => x.id);
  const seen = new Set();
  const out = [];
  for (const { a, id } of anchors) {
    if (seen.has(id)) continue;
    seen.add(id);
    let unit = a, node = a.parentElement, depth = 0;
    while (node && node.tagName !== 'BODY' && depth < 30) {
      const ids = idsIn(node);
      if (ids.size > 1) break;          // parent now spans other posts — stop
      if (ids.has(id)) unit = node;     // still just this post — keep climbing
      node = node.parentElement; depth++;
    }
    let caption = '';
    unit.querySelectorAll('div[dir="auto"]').forEach(d => {
      const art = d.closest('[role="article"]');
      if (art) {
        const l = art.getAttribute('aria-label') || '';
        if (/^\s*comment by/i.test(l) || /^\s*reply by/i.test(l)) return;  // skip comments
      }
      const t = (d.innerText || '').trim();
      if (t.length > caption.length) caption = t;  // caption = longest text block
    });
    out.push({ post_id: id, url: (a.href || '').split('?')[0], text: caption.slice(0, 2000) });
  }
  return out;
}
"""


def extract_handle_from_url(url: str | None) -> str | None:
    """Extract the vanity username from a facebook.com profile URL.

    Returns None for numeric-only profile IDs (``profile.php?id=...``), for
    URLs that point to posts/events/groups/pages rather than profiles, and for
    non-Facebook or empty inputs.

    Examples::

        extract_handle_from_url("https://www.facebook.com/johnandrew.balbarosa.58")
        # → "johnandrew.balbarosa.58"

        extract_handle_from_url("https://www.facebook.com/profile.php?id=100000123")
        # → None

    This is how ``ContactInfo.facebook`` should be auto-populated during a social
    scrape — the handle is sourced from the authenticated session redirect, not
    requested from the user.
    """
    if not url or "facebook.com" not in url.lower():
        return None

    # Strip query string and fragment; normalise trailing slash.
    url_clean = url.split("?")[0].split("#")[0].rstrip("/")

    # Numeric profile.php fallback → no vanity username available.
    if "profile.php" in url_clean.lower():
        return None

    # Extract the path segment after facebook.com/
    low = url_clean.lower()
    if "facebook.com/" not in low:
        return None
    path = url_clean.split("facebook.com/", 1)[1].lstrip("/")

    if not path:
        return None

    # Reject purely numeric paths (raw user IDs with no vanity username).
    if path.isdigit():
        return None

    # Reject known non-profile paths (posts, media, events, groups, pages …).
    if re.search(
        r"(posts|permalink|photo|videos|events|pages|groups|search|story\.php)",
        path,
        re.IGNORECASE,
    ):
        return None

    return path


def _snapshot_article(element) -> dict:
    """Extract a stable plain-dict snapshot of a single FB article element.

    The snapshot keeps everything we need (text, url, author, post_id) so the
    Playwright page can close before parsing — avoiding stale-handle errors.

    Comment articles are flagged via ``is_comment`` (no post permalink of their
    own) so the caller can drop them, and the post text excludes nested comments.
    """
    try:
        text = (element.evaluate(_POST_BODY_TEXT_JS) or "").strip()
    except Exception:  # noqa: BLE001
        text = (element.inner_text() or "").strip()

    href = ""
    is_comment = False
    try:
        info = element.evaluate(_POST_HREF_JS) or {}
        href = info.get("href") or ""
        is_comment = bool(info.get("isComment"))
    except Exception:  # noqa: BLE001
        pass

    author = ""
    try:
        # Author name lives in the post header strong/h-style element.
        author_el = element.query_selector("strong, h2, h3")
        if author_el:
            author = (author_el.inner_text() or "").strip().splitlines()[0]
    except Exception:  # noqa: BLE001
        pass

    if href.startswith("/"):
        href = f"https://www.facebook.com{href}"
    href = href.split("?")[0]  # drop comment_id / tracking query params
    post_id = href.rstrip("/").rsplit("/", 1)[-1] if href else f"render-{hash(text) & 0xFFFFFF}"

    return {
        "post_id": post_id,
        "url": href,
        "author": author,
        "text": text[:1000],
        "is_comment": is_comment,
    }


def _parse_cookie_header(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for chunk in raw.split(";"):
        if "=" in chunk:
            k, v = chunk.strip().split("=", 1)
            out[k.strip()] = v.strip()
    return out


def _strip_html(s: str) -> str:
    return _TAG_STRIP_RE.sub(" ", s).strip()


def _expand_see_more(page, *, max_clicks: int = 60) -> int:
    """Click inline 'See more' expanders so full post captions land in the DOM.

    FB truncates long captions at the DOM level (the rest isn't present until the
    button is clicked), so this is required in both headed and headless modes.
    Best-effort: snapshots the buttons once and clicks the 'See more' ones; failures
    on individual buttons are ignored. Returns how many were clicked.
    """
    clicked = 0
    try:
        buttons = page.query_selector_all('[role="button"]') or []
    except Exception as exc:  # noqa: BLE001 - page closed
        log.debug("see-more scan failed: %s", exc)
        return 0
    for b in buttons:
        if clicked >= max_clicks:
            break
        try:
            label = (b.inner_text() or "").strip().lower()
        except Exception:  # noqa: BLE001 - element detached
            continue
        if label != "see more":
            continue
        try:
            b.click(timeout=800)
            clicked += 1
            page.wait_for_timeout(120)
        except Exception as exc:  # noqa: BLE001 - non-expanding / detached button
            log.debug("see-more click skipped: %s", exc)
    return clicked


class FacebookVendor(SocialVendor):
    name = "facebook"

    def __init__(
        self,
        cookies: dict[str, str] | None = None,
        *,
        prefer_headless: bool = True,
        session_store: SessionStore | None = None,
    ) -> None:
        resolved = cookies if cookies is not None else resolve_session_cookies("facebook")
        if not resolved:
            log.warning(
                "Facebook vendor has no cookies (env FB_COOKIE / session store / "
                "browser jar all empty) — curl fallback will return []."
            )
        self._client = HttpClient(cookies=resolved)
        self._authenticated = bool(resolved)
        self._prefer_headless = prefer_headless
        self._store = session_store or SessionStore()
        # Cache the storage_state presence so we don't hit disk on every call.
        self._has_storage_state = self._store.load_storage_state("facebook") is not None

    # ---- public ----

    def resolve_own_handle(self) -> str | None:
        """Navigate to facebook.com/me with the authenticated session and return the vanity username.

        Facebook redirects ``/me`` to the user's actual profile URL.  The vanity
        path segment (e.g. ``"johnandrew.balbarosa.58"``) is extracted from the
        final URL via :func:`extract_handle_from_url` and returned.

        Numeric-only profile IDs (``profile.php?id=...``) return ``None`` — the
        account has no vanity username set.

        This is the canonical way to auto-populate ``ContactInfo.facebook`` during
        a social scrape so the value is sourced from the connected authenticated
        session rather than being asked from the user interactively.
        """
        if not self._has_storage_state:
            log.warning(
                "resolve_own_handle: no stored Facebook session; run 'resume-build login' first."
            )
            return None
        try:
            with PlaywrightSession("facebook", headless=False, store=self._store) as page:
                page.goto(
                    "https://www.facebook.com/me",
                    wait_until="networkidle",
                    timeout=20_000,
                )
                final_url = page.url
            return extract_handle_from_url(final_url)
        except Exception as exc:  # noqa: BLE001
            log.warning("resolve_own_handle failed: %s", exc)
            return None

    def fetch_own_posts(self, handle: str, limit: int = 50) -> list[SocialPost]:
        if self._prefer_headless and self._has_storage_state:
            posts = self._headless_own_posts(handle, limit)
            if posts:
                return posts
            log.info("headless FB own-posts returned empty; falling back to mbasic curl.")
        if not self._authenticated:
            return []
        try:
            html = self._get(f"{_BASE}/{handle}")
        except Exception as exc:  # noqa: BLE001
            log.warning("facebook mbasic fetch_own_posts failed: %s", exc)
            return []
        return list(self._parse_posts(html, owner=handle))[:limit]

    def search_mentions(self, full_name: str, limit: int = 50) -> list[SocialMention]:
        if self._prefer_headless and self._has_storage_state:
            mentions = self._headless_search_mentions(full_name, limit)
            if mentions:
                return mentions
            log.info("headless FB mentions returned empty; falling back to mbasic curl.")
        if not self._authenticated:
            return []
        try:
            html = self._get(f"{_BASE}/search/posts/", params={"q": full_name})
        except Exception as exc:  # noqa: BLE001
            log.warning("facebook mbasic search_mentions failed: %s", exc)
            return []
        return list(self._parse_mentions(html))[:limit]

    # ---- playwright scrape path (visible Chromium + scroll-to-load) ----

    def _headless_own_posts(self, handle: str, limit: int) -> list[SocialPost]:
        url = f"https://www.facebook.com/{handle}"
        try:
            records = self._scrape_own_post_records(url, max_scrolls=60)
        except NoStoredSessionError:
            return []
        posts = list(self._records_to_posts(records, profile_url=url))
        return posts[:limit] if limit else posts

    def _scrape_own_post_records(self, url: str, *, max_scrolls: int) -> list[dict]:
        """Load the profile feed and extract own posts by permalink anchor.

        Posts on modern FB profiles are NOT ``role="article"`` (only comments are), so
        we scroll to load the feed, then run one in-page pass that finds each post via
        its permalink/timestamp anchor and reads the caption. Returns plain dicts so
        the page can close before we build models.
        """
        anchor_selector = 'a[href*="__cft__"]'
        records: list[dict] = []
        with PlaywrightSession("facebook", headless=False, store=self._store) as page:
            page.goto(url, wait_until="domcontentloaded")
            try:
                page.wait_for_selector(anchor_selector, timeout=20_000)
            except Exception as exc:  # noqa: BLE001
                log.warning("FB feed didn't render at %s (continuing best-effort): %s", url, exc)
            scroll_collect(page, anchor_selector, max_scrolls=max_scrolls, settle_ms=3000)
            # Expand "See more" so full captions are in the DOM before we read them.
            # This is DOM-level truncation, not a render artifact — it must be clicked
            # whether headed or headless.
            expanded = _expand_see_more(page)
            if expanded:
                log.info("FB expanded %d 'See more' caption(s)", expanded)
            # Optional slow, visible step-through for debugging: non-destructive overlay
            # highlights (post / comments / images / text / shared) + a live HUD.
            step_limit = step_limit_from_env()
            if step_limit:
                step_through_articles(page, _POST_ARTICLE_SELECTOR, limit=step_limit)
            try:
                records = page.evaluate(_EXTRACT_OWN_POSTS_JS) or []
            except Exception as exc:  # noqa: BLE001
                log.warning("FB own-post extraction failed: %s", exc)
            log.info("FB extracted %d own-post record(s) at %s", len(records), url)
        return records

    @staticmethod
    def _records_to_posts(records: list[dict], profile_url: str) -> Iterable[SocialPost]:
        """Turn extracted post dicts into models — dedupe by id, drop captionless posts."""
        seen_ids: set[str] = set()
        for rec in records:
            post_id = (rec.get("post_id") or "").strip()
            text = (rec.get("text") or "").strip()
            if not post_id or not text or post_id in seen_ids:
                continue
            seen_ids.add(post_id)
            yield SocialPost(
                vendor="facebook",
                post_id=post_id,
                url=rec.get("url") or profile_url,
                text=text,
            )

    def _headless_search_mentions(self, full_name: str, limit: int) -> list[SocialMention]:
        from urllib.parse import quote_plus

        url = f"https://www.facebook.com/search/posts/?q={quote_plus(full_name)}"
        try:
            articles = self._scrape_articles(url, max_scrolls=30)
        except NoStoredSessionError:
            return []
        mentions = list(self._articles_to_mentions(articles, query_url=url, full_name=full_name))
        return mentions[:limit] if limit else mentions

    def _scrape_articles(self, url: str, *, max_scrolls: int) -> list[dict]:
        """Drive a visible Chromium to ``url``, scroll until the feed stops growing,
        and snapshot each article into a plain dict so the page can close before parsing.
        """
        records: list[dict] = []
        with PlaywrightSession("facebook", headless=False, store=self._store) as page:
            page.goto(url, wait_until="domcontentloaded")
            # Wait for real posts to render rather than div[role='main']: FB ships a
            # hidden placeholder main that never becomes visible, so waiting on it
            # times out even when the feed is fine. On timeout we continue best-effort
            # and let scroll_collect return whatever (possibly nothing) is present.
            try:
                page.wait_for_selector(_POST_ARTICLE_SELECTOR, timeout=20_000)
            except Exception as exc:  # noqa: BLE001
                log.warning("FB posts didn't render at %s (continuing best-effort): %s", url, exc)
            articles = scroll_collect(
                page,
                _POST_ARTICLE_SELECTOR,
                max_scrolls=max_scrolls,
                settle_ms=3000,
            )
            log.info("FB scrape captured %d articles at %s", len(articles), url)
            # Optional slow, visible step-through: walk the first N posts with overlay
            # highlights + a live HUD so the user can verify focus (non-destructive).
            step_limit = step_limit_from_env()
            if step_limit:
                step_through_articles(page, _POST_ARTICLE_SELECTOR, limit=step_limit)
            for art in articles:
                try:
                    records.append(_snapshot_article(art))
                except Exception as exc:  # noqa: BLE001
                    log.debug("article snapshot failed: %s", exc)
        return records

    @staticmethod
    def _articles_to_mentions(
        records: list[dict], query_url: str, full_name: str
    ) -> Iterable[SocialMention]:
        name_lower = full_name.lower()
        seen_ids: set[str] = set()
        for rec in records:
            if rec.get("is_comment"):
                continue
            mention_id = rec["post_id"]
            text = rec["text"]
            if not text or mention_id in seen_ids:
                continue
            # Only treat as a mention if the searched name actually appears in
            # the post body — FB's search returns ambient noise too.
            if name_lower not in text.lower():
                continue
            seen_ids.add(mention_id)
            yield SocialMention(
                vendor="facebook",
                mention_id=mention_id,
                url=rec["url"] or query_url,
                text=text,
                author_name=rec["author"],
            )

    @staticmethod
    def _parse_rendered_posts(html: str, profile_url: str) -> Iterable[SocialPost]:
        """Pull post text out of the rendered React feed.

        FB posts on the modern site live inside ``<div role="article">`` blocks; we
        snapshot the inner text and use the article anchor's ``href`` as the post id.
        """
        if not html:
            return
        article_re = re.compile(
            r'role="article"[^>]*>(.*?)(?=role="article"|</body>)',
            re.IGNORECASE | re.DOTALL,
        )
        href_re = re.compile(r'href="(/[^"]*?/posts/[^"]+|/permalink/\d+[^"]*)"')
        for match in article_re.finditer(html):
            block = match.group(1)
            href_m = href_re.search(block)
            text = _strip_html(block)[:600]
            if not text:
                continue
            link = href_m.group(1) if href_m else ""
            post_id = (
                link.rsplit("/", 1)[-1].split("?")[0] if link else f"render-{hash(text) & 0xFFFFFF}"
            )
            yield SocialPost(
                vendor="facebook",
                post_id=post_id,
                url=f"https://www.facebook.com{link}" if link else profile_url,
                text=text,
            )

    @staticmethod
    def _parse_rendered_mentions(html: str, query_url: str) -> Iterable[SocialMention]:
        if not html:
            return
        article_re = re.compile(
            r'role="article"[^>]*>(.*?)(?=role="article"|</body>)',
            re.IGNORECASE | re.DOTALL,
        )
        href_re = re.compile(r'href="(/[^"]*?/posts/[^"]+|/permalink/\d+[^"]*)"')
        author_re = re.compile(r"<strong[^>]*>([^<]{1,80})</strong>")
        for match in article_re.finditer(html):
            block = match.group(1)
            href_m = href_re.search(block)
            author_m = author_re.search(block)
            text = _strip_html(block)[:600]
            if not text:
                continue
            link = href_m.group(1) if href_m else ""
            mention_id = (
                link.rsplit("/", 1)[-1].split("?")[0] if link else f"render-{hash(text) & 0xFFFFFF}"
            )
            yield SocialMention(
                vendor="facebook",
                mention_id=mention_id,
                url=f"https://www.facebook.com{link}" if link else query_url,
                text=text,
                author_name=(author_m.group(1).strip() if author_m else ""),
            )

    # ---- internals ----

    def _get(self, url: str, **kwargs: object) -> str:
        resp = self._client.get(url, **kwargs)
        return getattr(resp, "text", "") or ""

    def _parse_posts(self, html: str, owner: str) -> Iterable[SocialPost]:
        seen: set[str] = set()
        for link_match in _POST_LINK_RE.finditer(html):
            link = link_match.group(1)
            if link in seen:
                continue
            seen.add(link)
            window = html[link_match.start() : link_match.start() + 2000]
            text = self._extract_text(window)
            if not text:
                continue
            post_id_match = re.search(r"story_fbid=(\d+)", link)
            post_id = post_id_match.group(1) if post_id_match else link
            yield SocialPost(
                vendor=self.name,
                post_id=post_id,
                url=f"{_BASE}{link}",
                text=text,
            )

    def _parse_mentions(self, html: str) -> Iterable[SocialMention]:
        for block_match in _POST_LINK_RE.finditer(html):
            link = block_match.group(1)
            window = html[max(0, block_match.start() - 400) : block_match.start() + 2000]
            text = self._extract_text(window)
            if not text:
                continue
            author_match = _AUTHOR_RE.search(window)
            author = author_match.group(1) if author_match else ""
            post_id_match = re.search(r"story_fbid=(\d+)", link)
            mention_id = post_id_match.group(1) if post_id_match else link
            yield SocialMention(
                vendor=self.name,
                mention_id=mention_id,
                url=f"{_BASE}{link}",
                text=text,
                author_name=author,
            )

    @staticmethod
    def _extract_text(window: str) -> str:
        for m in _TEXT_BLOCK_RE.finditer(window):
            body = _strip_html(m.group(1))
            if len(body) > 12:
                return body
        return ""


_HIDDEN_RE = re.compile(
    r'<input[^>]+type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', re.IGNORECASE
)
_CHECKPOINT_URL_RE = re.compile(r"https://[^\"' ]*checkpoint[^\"' ]*")


class FacebookLogin:
    """Facebook web login. mbasic.facebook.com is the friendliest surface for non-JS scripts.

    Realistic note: a fresh programmatic login from an unrecognized IP almost
    always lands on a checkpoint page that needs photo/identity verification —
    no console can answer that. Caller should fall back to ``browser_cookies``.
    """

    _LOGIN_PAGE = "https://mbasic.facebook.com/login.php"
    _LOGIN_SUBMIT = "https://mbasic.facebook.com/login/device-based/regular/login/"
    _CHECKPOINT_SUBMIT = "https://mbasic.facebook.com/login/checkpoint/"

    def __init__(self, client: HttpClient | None = None) -> None:
        self._client = client or HttpClient(min_interval_s=2.5)

    def run(self, creds: Credentials, prompt: LoginPrompt) -> dict[str, str]:
        hidden = self._fetch_form()
        hidden.update({"email": creds.username, "pass": creds.password, "login": "Log In"})
        resp = self._client.post(self._LOGIN_SUBMIT, data=hidden, allow_redirects=True)
        body = getattr(resp, "text", "") or ""
        url = getattr(resp, "url", "") or ""
        if "checkpoint" in url.lower() or "checkpoint" in body[:4000].lower():
            self._handle_checkpoint(body, prompt)
        cookies = self._extract_fb_cookies()
        if "c_user" not in cookies or "xs" not in cookies:
            raise LoginError(
                "facebook login: c_user / xs cookies not set — checkpoint likely; "
                "try browser_cookies fallback."
            )
        return cookies

    def _fetch_form(self) -> dict[str, str]:
        resp = self._client.get(self._LOGIN_PAGE)
        html = getattr(resp, "text", "") or ""
        return dict(_HIDDEN_RE.findall(html))

    def _handle_checkpoint(self, html: str, prompt: LoginPrompt) -> None:
        if "approvals_code" not in html and "2fa" not in html.lower():
            raise LoginError(
                "facebook login: checkpoint requires browser (photo / identity check)."
            )
        fields = dict(_HIDDEN_RE.findall(html))
        code = prompt.ask("Facebook: enter the 2FA code (authenticator / SMS)")
        fields["approvals_code"] = code
        fields["submit[Submit Code]"] = "Submit Code"
        self._client.post(self._CHECKPOINT_SUBMIT, data=fields, allow_redirects=True)

    def _extract_fb_cookies(self) -> dict[str, str]:
        jar = getattr(self._client, "cookies", None)
        if jar is None:
            return {}
        out: dict[str, str] = {}
        for c in jar:
            name = getattr(c, "name", None)
            value = getattr(c, "value", None)
            if name in ("c_user", "xs", "fr", "datr") and value:
                out[name] = value
        return out


def login_facebook(creds: Credentials, prompt: LoginPrompt) -> dict[str, str]:
    return FacebookLogin().run(creds, prompt)
