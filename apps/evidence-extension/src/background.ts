import { aiClear, aiComplete, aiConfigure, aiStatus, LocalAIError, type CompletionRequest, type LocalAIConfig } from "./local-ai.js";

type EvidenceSource = "facebook" | "linkedin" | "github";
type BridgeCommand = { type: string; requestId: string; source?: EvidenceSource; provider?: EvidenceSource; profileUrl?: string; config?: LocalAIConfig; request?: CompletionRequest };
const AI_TYPES = ["PYTORCH_PH_AI_STATUS", "PYTORCH_PH_AI_CONFIGURE", "PYTORCH_PH_AI_CLEAR", "PYTORCH_PH_AI_COMPLETE"];
type Identity = { provider: EvidenceSource; handle: string; profileUrl: string };

const PAGE_LOAD_TIMEOUT_MS = 20_000;
const TAB_POLL_MS = 250;
const PROFILE_SETTLE_MS = 1_500;
const COLLECTOR_RETRIES = 8;
const MAX_CAPTURE_WIDTH = 1_600;
const MAX_CAPTURE_BYTES = 900_000;

// Stops a command with a code the portal turns into a readable message.
class BridgeFailure extends Error {
  constructor(readonly code: string, readonly humanGate = true) { super(code); }
}

const sourceHost = {
  facebook: /(^|\.)facebook\.com$/,
  linkedin: /(^|\.)linkedin\.com$/,
  github: /^github\.com$/,
} satisfies Record<EvidenceSource, RegExp>;

// The logged-in session redirects these to the member's own profile.
const IDENTITY_URL: Record<EvidenceSource, string> = {
  github: "https://github.com/",
  linkedin: "https://www.linkedin.com/in/me/",
  facebook: "https://www.facebook.com/me",
};

const GITHUB_RESERVED = new Set(["login", "logout", "settings", "orgs", "organizations", "explore", "marketplace", "notifications", "new", "features", "pricing", "topics", "trending", "sponsors", "about"]);
const FACEBOOK_RESERVED = new Set(["me", "login", "login.php", "checkpoint", "home.php", "recover", "watch", "groups", "marketplace", "gaming", "friends", "settings"]);

function matchesSource(url: string | undefined, source: EvidenceSource) {
  if (!url) return false;
  try { return new URL(url).protocol === "https:" && sourceHost[source].test(new URL(url).hostname); }
  catch { return false; }
}

// Commands are honored only from the portal's own pages.
function isPortalSender(sender: ChromeMessageSender) {
  try {
    const host = new URL(sender.tab?.url || "").hostname;
    return host === "pytorch.ph" || host.endsWith(".pytorch.ph") || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function profileFromUrl(provider: EvidenceSource, raw: string | undefined): Identity | null {
  let url: URL;
  try { url = new URL(raw || ""); } catch { return null; }
  if (url.protocol !== "https:" || !sourceHost[provider].test(url.hostname)) return null;
  if (provider === "github") {
    const login = /^\/([A-Za-z0-9-]{1,39})\/?$/.exec(url.pathname)?.[1];
    return login && !GITHUB_RESERVED.has(login.toLowerCase()) ? { provider, handle: login, profileUrl: `https://github.com/${login}` } : null;
  }
  if (provider === "linkedin") {
    const slug = /^\/in\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    return slug && slug !== "me" ? { provider, handle: decodeURIComponent(slug), profileUrl: `https://www.linkedin.com/in/${slug}/` } : null;
  }
  const id = url.pathname === "/profile.php" ? url.searchParams.get("id") : null;
  if (id && /^\d+$/.test(id)) return { provider, handle: id, profileUrl: `https://www.facebook.com/profile.php?id=${id}` };
  const name = /^\/([A-Za-z0-9.]{5,50})\/?$/.exec(url.pathname)?.[1];
  return name && !FACEBOOK_RESERVED.has(name.toLowerCase()) ? { provider, handle: name, profileUrl: `https://www.facebook.com/${name}` } : null;
}

function isLoginUrl(raw: string | undefined) {
  try { return /login|checkpoint|authwall|signup|recover|two_step/i.test(new URL(raw || "").pathname); }
  catch { return false; }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTab(tabId: number, ready: (tab: ChromeTab) => boolean = () => true) {
  const deadline = Date.now() + PAGE_LOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && ready(tab)) return tab;
    await sleep(TAB_POLL_MS);
  }
  throw new BridgeFailure("page_timeout", false);
}

// Opens a background tab in the user's own browser session and always closes it.
async function withTab<T>(url: string, run: (tabId: number) => Promise<T>) {
  const tab = await chrome.tabs.create({ url, active: false });
  if (tab.id === undefined) throw new BridgeFailure("collector_unavailable", false);
  try { return await run(tab.id); }
  finally { await chrome.tabs.remove(tab.id).catch(() => undefined); }
}

// The content script appears once the page is idle, so early messages are retried.
async function askTab(tabId: number, message: unknown): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < COLLECTOR_RETRIES; attempt += 1) {
    const reply = await new Promise<Record<string, unknown> | null>((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (value) => resolve(chrome.runtime.lastError ? null : value as Record<string, unknown>));
    });
    if (reply) return reply;
    await sleep(500);
  }
  throw new BridgeFailure("collector_unavailable", false);
}

async function resolveIdentity(provider: EvidenceSource): Promise<Identity> {
  return withTab(IDENTITY_URL[provider], async (tabId) => {
    if (provider === "github") {
      await waitForTab(tabId);
      const reply = await askTab(tabId, { type: "PYTORCH_PH_READ_IDENTITY" });
      if (reply.access && reply.access !== "clear") throw new BridgeFailure(String(reply.access));
      const identity = profileFromUrl("github", `https://github.com/${String(reply.login || "")}`);
      if (!reply.login || !identity) throw new BridgeFailure("login_required");
      return identity;
    }
    const tab = await waitForTab(tabId, (candidate) => Boolean(profileFromUrl(provider, candidate.url) || isLoginUrl(candidate.url)));
    const identity = profileFromUrl(provider, tab.url);
    if (!identity) throw new BridgeFailure("login_required");
    return identity;
  });
}

async function collectProfile(provider: EvidenceSource, profileUrl: string | undefined) {
  const wanted = profileFromUrl(provider, profileUrl);
  if (!wanted) throw new BridgeFailure("unsupported_page");
  const signedIn = await resolveIdentity(provider);
  if (signedIn.handle.toLowerCase() !== wanted.handle.toLowerCase()) throw new BridgeFailure("identity_mismatch");
  return withTab(signedIn.profileUrl, async (tabId) => {
    const tab = await waitForTab(tabId);
    await sleep(PROFILE_SETTLE_MS);
    if (provider !== "github" && profileFromUrl(provider, tab.url)?.handle.toLowerCase() !== signedIn.handle.toLowerCase()) {
      throw new BridgeFailure(isLoginUrl(tab.url) ? "login_required" : "identity_mismatch");
    }
    const reply = await askTab(tabId, {
      type: "PYTORCH_PH_COLLECT_PAGE",
      requestId: crypto.randomUUID(),
      mode: "profile",
      expectedLogin: provider === "github" ? signedIn.handle : undefined,
    });
    if (!reply.ok) throw new BridgeFailure(String(reply.code || "collection_failed"), reply.humanGate === true);
    return reply.preview;
  });
}

async function blobToDataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
}

// Screenshot of the portal tab that asked, capped in width and size for a bug report.
async function captureVisible(sender: ChromeMessageSender) {
  if (sender.tab?.windowId === undefined) throw new BridgeFailure("capture_failed", false);
  const original = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "jpeg", quality: 60 });
  const blob = await (await fetch(original)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_CAPTURE_WIDTH / bitmap.width);
  if (scale === 1 && blob.size <= MAX_CAPTURE_BYTES) return original;
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.6, 0.45, 0.3]) {
    const resized = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (resized.size <= MAX_CAPTURE_BYTES) return blobToDataUrl(resized);
  }
  throw new BridgeFailure("capture_too_large", false);
}

function collectActive(command: BridgeCommand, respond: (value: unknown) => void) {
  const source = command.source;
  if (!source || !(source in sourceHost)) return respond({ ok: false, requestId: command.requestId, code: "unsupported_page", humanGate: true });
  chrome.tabs.query({}, (tabs) => {
    const tab = tabs.filter((candidate) => matchesSource(candidate.url, source)).sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0];
    if (!tab?.id) {
      respond({ ok: false, requestId: command.requestId, code: "source_tab_missing", humanGate: true });
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "PYTORCH_PH_COLLECT_PAGE", requestId: command.requestId }, (result) => {
      if (chrome.runtime.lastError) respond({ ok: false, requestId: command.requestId, code: "collector_unavailable" });
      else respond(result);
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const command = message as Partial<BridgeCommand>;
  const known = ["PYTORCH_PH_COLLECT_ACTIVE", "PYTORCH_PH_CAPTURE_VISIBLE", "PYTORCH_PH_VERIFY_IDENTITY", "PYTORCH_PH_COLLECT_PROFILE", ...AI_TYPES];
  if (!command.type || !known.includes(command.type) || typeof command.requestId !== "string") return;
  const requestId = command.requestId;
  if (!isPortalSender(sender)) {
    respond({ ok: false, requestId, code: "untrusted_sender" });
    return;
  }
  if (command.type === "PYTORCH_PH_COLLECT_ACTIVE") {
    collectActive(command as BridgeCommand, respond);
    return true;
  }
  if (AI_TYPES.includes(command.type)) {
    handleLocalAI(command as BridgeCommand).then(respond);
    return true;
  }
  const provider = command.provider;
  const run = async () => {
    if (command.type === "PYTORCH_PH_CAPTURE_VISIBLE") return { ok: true, requestId, dataUrl: await captureVisible(sender) };
    if (!provider || !(provider in sourceHost)) throw new BridgeFailure("unsupported_page");
    if (command.type === "PYTORCH_PH_VERIFY_IDENTITY") return { ok: true, requestId, identity: await resolveIdentity(provider) };
    return { ok: true, requestId, preview: await collectProfile(provider, command.profileUrl) };
  };
  run().then(respond, (error: unknown) => respond(error instanceof BridgeFailure
    ? { ok: false, requestId, code: error.code, humanGate: error.humanGate }
    : { ok: false, requestId, code: command.type === "PYTORCH_PH_CAPTURE_VISIBLE" ? "capture_failed" : "collection_failed" }));
  return true;
});

// Local AI commands. Replies carry status or text only; the stored key never leaves the extension.
async function handleLocalAI(command: BridgeCommand) {
  const requestId = command.requestId;
  try {
    if (command.type === "PYTORCH_PH_AI_STATUS") return { ok: true, requestId, status: await aiStatus() };
    if (command.type === "PYTORCH_PH_AI_CONFIGURE") return { ok: true, requestId, status: await aiConfigure(command.config ?? { provider: "", model: "" }) };
    if (command.type === "PYTORCH_PH_AI_CLEAR") { await aiClear(); return { ok: true, requestId }; }
    return { ok: true, requestId, text: await aiComplete(command.request ?? { prompt: "" }) };
  } catch (error) {
    return { ok: false, requestId, code: "local_ai_failed", message: error instanceof LocalAIError ? error.message : "The local AI request failed." };
  }
}
