type AccessState = "clear" | "login_required" | "verification_required" | "rate_limited";
type EvidenceLevel = "participation" | "contributor" | "finalist_lead" | "winner_top_award";

function accessState(): AccessState {
  const text = document.body?.innerText.slice(0, 20_000).toLowerCase() || "";
  if (/captcha|verify (that )?you are human|security check|checkpoint|cloudflare/.test(text)) return "verification_required";
  if (/too many requests|rate limit|try again later/.test(text)) return "rate_limited";
  if (/sign in|log in|join linkedin/.test(text) && !document.querySelector("article,[data-urn],li[itemprop='owns']")) return "login_required";
  return "clear";
}

function source(): "facebook" | "linkedin" | "github" {
  if (location.hostname.endsWith("facebook.com")) return "facebook";
  if (location.hostname.endsWith("linkedin.com")) return "linkedin";
  return "github";
}

function supportedPage() {
  if (source() === "github") return /^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?\/?$/.test(location.pathname);
  if (source() === "linkedin") return /\/feed\/update\/|\/posts\//.test(location.pathname);
  return /\/posts\/|\/permalink\.php$|\/story\.php$|\/photo\.php$/.test(location.pathname) || new URLSearchParams(location.search).has("story_fbid");
}

function canonicalUrl(node: Element) {
  const link = node.querySelector<HTMLAnchorElement>("a[href*='/posts/'],a[href*='/activity/'],a[href*='/feed/update/'],a[itemprop='name codeRepository'],h3 a[href]");
  try { return new URL(link?.href || location.href, location.origin).toString(); } catch { return location.href; }
}

function candidates() {
  const selector = source() === "github" ? "li[itemprop='owns']" : source() === "linkedin" ? "[data-urn^='urn:li:activity'],article" : "[role='article'],article";
  return [...document.querySelectorAll(selector)].slice(0, 50).map((node, index) => {
    const text = (node as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 5_000);
    return {
      title: text.split(/[.!?\n]/)[0].slice(0, 240) || `Evidence ${index + 1}`,
      text,
      sourceUrl: canonicalUrl(node),
      postedAt: null,
      mediaUrls: [] as string[],
      evidenceKind: source() === "github" ? "project" as const : "achievement" as const,
      department: "academics" as const,
      proposedLevel: "participation" as EvidenceLevel,
    };
  }).filter((item) => item.text.length > 0);
}

async function fingerprint() {
  const shape = `${location.hostname}:${[...document.querySelectorAll("article,[data-urn],li[itemprop='owns']")].slice(0, 80).map((node) => `${node.tagName}:${node.getAttribute("role") || ""}`).join("|")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(shape));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  const value = message as { type?: string; requestId?: string };
  if (value.type !== "PYTORCH_PH_COLLECT_PAGE") return;
  void (async () => {
    const access = accessState();
    if (access !== "clear") return respond({ ok: false, requestId: value.requestId, code: access, humanGate: true });
    if (!supportedPage()) return respond({ ok: false, requestId: value.requestId, code: "unsupported_page", humanGate: true });
    const items = candidates();
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
