type AccessState = "clear" | "login_required" | "verification_required" | "rate_limited";
type EvidenceLevel = "participation" | "contributor" | "finalist_lead" | "winner_top_award";
type CollectedItem = {
  title: string;
  text: string;
  sourceUrl: string;
  postedAt: null;
  mediaUrls: string[];
  evidenceKind: "project" | "achievement";
  department: "academics";
  proposedLevel: EvidenceLevel;
};

const MAX_ITEMS = 50;
const MAX_ITEM_TEXT = 5_000;
const MIN_SECTION_TEXT = 20;

// Profile pages are opened on the member's own signed-in session, so only human-verification
// and rate-limit gates apply there; login is checked from the page identity instead.
function accessState(profileMode = false): AccessState {
  const text = document.body?.innerText.slice(0, 20_000).toLowerCase() || "";
  if (/captcha|verify (that )?you are human|security check|checkpoint|cloudflare/.test(text)) return "verification_required";
  if (/too many requests|rate limit|try again later/.test(text)) return "rate_limited";
  if (!profileMode && /sign in|log in|join linkedin/.test(text) && !document.querySelector("article,[data-urn],li[itemprop='owns']")) return "login_required";
  return "clear";
}

function source(): "facebook" | "linkedin" | "github" {
  if (location.hostname.endsWith("facebook.com")) return "facebook";
  if (location.hostname.endsWith("linkedin.com")) return "linkedin";
  return "github";
}

function githubLogin() {
  return document.querySelector<HTMLMetaElement>("meta[name='user-login']")?.content.trim() || "";
}

function supportedPage(profileMode: boolean) {
  if (profileMode) {
    if (source() === "github") return /^\/[A-Za-z0-9-]{1,39}\/?$/.test(location.pathname);
    if (source() === "linkedin") return /^\/in\/[^/]+\/?$/.test(location.pathname);
    return true;
  }
  if (source() === "github") return /^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?\/?$/.test(location.pathname);
  if (source() === "linkedin") return /\/feed\/update\/|\/posts\//.test(location.pathname);
  return /\/posts\/|\/permalink\.php$|\/story\.php$|\/photo\.php$/.test(location.pathname) || new URLSearchParams(location.search).has("story_fbid");
}

function canonicalUrl(node: Element) {
  const link = node.querySelector<HTMLAnchorElement>("a[href*='/posts/'],a[href*='/activity/'],a[href*='/feed/update/'],a[itemprop='name codeRepository'],h3 a[href]");
  try { return new URL(link?.href || location.href, location.origin).toString(); } catch { return location.href; }
}

function cleanText(node: Element | null) {
  return ((node as HTMLElement | null)?.innerText || "").replace(/\s+/g, " ").trim().slice(0, MAX_ITEM_TEXT);
}

function toItem(text: string, sourceUrl: string, index: number): CollectedItem {
  return {
    title: text.split(/[.!?\n]/)[0].slice(0, 240) || `Evidence ${index + 1}`,
    text,
    sourceUrl,
    postedAt: null,
    mediaUrls: [],
    evidenceKind: source() === "github" ? "project" : "achievement",
    department: "academics",
    proposedLevel: "participation",
  };
}

function candidates(): CollectedItem[] {
  const selector = source() === "github" ? "li[itemprop='owns']" : source() === "linkedin" ? "[data-urn^='urn:li:activity'],article" : "[role='article'],article";
  return [...document.querySelectorAll(selector)].slice(0, MAX_ITEMS)
    .map((node, index) => toItem(cleanText(node), canonicalUrl(node), index))
    .filter((item) => item.text.length > 0);
}

// Own-profile collection: GitHub bio, profile README and pinned/popular repositories;
// LinkedIn and Facebook profile sections as rendered for the signed-in member.
function profileCandidates(): CollectedItem[] {
  if (source() === "github") {
    const name = cleanText(document.querySelector(".p-name")) || githubLogin();
    const bio = cleanText(document.querySelector(".p-note, [data-bio-text]"));
    const readme = cleanText(document.querySelector("article.markdown-body"));
    const summary = [bio, readme].filter(Boolean).join(" · ");
    const profile = summary ? [{ ...toItem(summary, location.href, 0), title: `GitHub profile: ${name}`.slice(0, 240) }] : [];
    const repos = [...document.querySelectorAll(".js-pinned-item-list-item, .pinned-item-list-item")].map((node, index) => {
      const link = node.querySelector<HTMLAnchorElement>("a[href]");
      const url = link ? new URL(link.href, location.origin).toString() : location.href;
      return toItem(cleanText(node), url, index + 1);
    });
    return [...profile, ...repos].filter((item) => item.text.length > 0).slice(0, MAX_ITEMS);
  }
  const selector = source() === "linkedin" ? "main section" : "[role='main'] [role='article'], [role='main'] [data-pagelet*='Intro'], [role='main'] [data-pagelet*='ProfileTile']";
  return [...document.querySelectorAll(selector)]
    .map((node, index) => toItem(cleanText(node), location.href, index))
    .filter((item) => item.text.length >= MIN_SECTION_TEXT)
    .slice(0, MAX_ITEMS);
}

async function fingerprint() {
  const shape = `${location.hostname}:${[...document.querySelectorAll("article,[data-urn],li[itemprop='owns'],main section,.pinned-item-list-item")].slice(0, 80).map((node) => `${node.tagName}:${node.getAttribute("role") || ""}`).join("|")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(shape));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  const value = message as { type?: string; requestId?: string; mode?: string; expectedLogin?: string };
  if (value.type === "PYTORCH_PH_READ_IDENTITY") {
    respond({ access: accessState(true), login: source() === "github" ? githubLogin() || null : null, url: location.href });
    return;
  }
  if (value.type !== "PYTORCH_PH_COLLECT_PAGE") return;
  const profileMode = value.mode === "profile";
  void (async () => {
    const access = accessState(profileMode);
    if (access !== "clear") return respond({ ok: false, requestId: value.requestId, code: access, humanGate: true });
    if (profileMode && value.expectedLogin !== undefined) {
      const login = githubLogin();
      if (!login) return respond({ ok: false, requestId: value.requestId, code: "login_required", humanGate: true });
      if (login.toLowerCase() !== value.expectedLogin.toLowerCase()) return respond({ ok: false, requestId: value.requestId, code: "identity_mismatch", humanGate: true });
    }
    if (!supportedPage(profileMode)) return respond({ ok: false, requestId: value.requestId, code: "unsupported_page", humanGate: true });
    const items = profileMode ? profileCandidates() : candidates();
    if (!items.length) return respond({ ok: false, requestId: value.requestId, code: "layout_drift", humanGate: true });
    const pageUrl = location.href;
    respond({
      ok: true,
      requestId: value.requestId,
      preview: {
        schemaVersion: 1,
        source: source(),
        origin: "extension_scrape",
        collectedAt: new Date().toISOString(),
        adapterVersion: chrome.runtime.getManifest().version,
        layoutFingerprint: await fingerprint(),
        pageUrl,
        contentHash: `sha256:${await sha256(JSON.stringify({ source: source(), pageUrl, items }))}`,
        items,
        warnings: [],
      },
    });
  })().catch(() => respond({ ok: false, requestId: value.requestId, code: "collection_failed" }));
  return true;
});
