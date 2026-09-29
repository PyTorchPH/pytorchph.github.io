const VERSION = chrome.runtime.getManifest().version;
const PROVIDERS = ["facebook", "linkedin", "github"];
const CAPABILITIES = [...PROVIDERS, "capture_visible", "verify_identity", "collect_profile", "local_ai"];
// Portal command → background message type. Anything else is ignored.
const RUNTIME_TYPES: Record<string, string> = {
  collect_active: "PYTORCH_PH_COLLECT_ACTIVE",
  capture_visible: "PYTORCH_PH_CAPTURE_VISIBLE",
  verify_identity: "PYTORCH_PH_VERIFY_IDENTITY",
  collect_profile: "PYTORCH_PH_COLLECT_PROFILE",
  ai_status: "PYTORCH_PH_AI_STATUS",
  ai_configure: "PYTORCH_PH_AI_CONFIGURE",
  ai_clear: "PYTORCH_PH_AI_CLEAR",
  ai_complete: "PYTORCH_PH_AI_COMPLETE",
};
const PROVIDER_FREE = new Set(["capture_visible", "ai_status", "ai_configure", "ai_clear", "ai_complete"]);

function reportStatus(nonce: unknown) {
  window.dispatchEvent(new CustomEvent("PYTORCH_PH_EXTENSION_STATUS", {
    detail: { nonce, state: "available", version: VERSION, capabilities: CAPABILITIES },
  }));
}

// Objects cross from the page as JSON strings so they survive the isolated-world boundary.
function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || value.length > 250_000) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function bridgeResult(detail: unknown) {
  window.dispatchEvent(new CustomEvent("PYTORCH_PH_EXTENSION_RESULT", { detail }));
}

window.addEventListener("PYTORCH_PH_EXTENSION_PROBE", (event) => reportStatus((event as CustomEvent).detail?.nonce));
window.addEventListener("PYTORCH_PH_EXTENSION_COMMAND", (event) => {
  const detail = (event as CustomEvent).detail;
  if (!detail || typeof detail.requestId !== "string") return;
  const type = RUNTIME_TYPES[detail.action];
  if (!type) return;
  const provider = detail.source ?? detail.provider;
  if (!PROVIDER_FREE.has(detail.action) && !PROVIDERS.includes(provider)) return;
  const message = {
    type,
    requestId: detail.requestId,
    source: provider,
    provider,
    profileUrl: typeof detail.profileUrl === "string" ? detail.profileUrl : undefined,
    config: detail.action === "ai_configure" ? jsonObject(detail.config) : undefined,
    request: detail.action === "ai_complete" ? jsonObject(detail.request) : undefined,
  };
  chrome.runtime.sendMessage(message, (result) => {
    if (chrome.runtime.lastError || !result) bridgeResult({ ok: false, requestId: detail.requestId, code: "extension_unavailable" });
    else bridgeResult(result);
  });
});

reportStatus(null);
