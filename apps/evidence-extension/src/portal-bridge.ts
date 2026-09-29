const VERSION = chrome.runtime.getManifest().version;
const PROVIDERS = ["facebook", "linkedin", "github"];
const CAPABILITIES = [...PROVIDERS, "capture_visible", "verify_identity", "collect_profile"];
// Portal command → background message type. Anything else is ignored.
const RUNTIME_TYPES: Record<string, string> = {
  collect_active: "PYTORCH_PH_COLLECT_ACTIVE",
  capture_visible: "PYTORCH_PH_CAPTURE_VISIBLE",
  verify_identity: "PYTORCH_PH_VERIFY_IDENTITY",
  collect_profile: "PYTORCH_PH_COLLECT_PROFILE",
};

function reportStatus(nonce: unknown) {
  window.dispatchEvent(new CustomEvent("PYTORCH_PH_EXTENSION_STATUS", {
    detail: { nonce, state: "available", version: VERSION, capabilities: CAPABILITIES },
  }));
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
  if (detail.action !== "capture_visible" && !PROVIDERS.includes(provider)) return;
  const message = {
    type,
    requestId: detail.requestId,
    source: provider,
    provider,
    profileUrl: typeof detail.profileUrl === "string" ? detail.profileUrl : undefined,
  };
  chrome.runtime.sendMessage(message, (result) => {
    if (chrome.runtime.lastError || !result) bridgeResult({ ok: false, requestId: detail.requestId, code: "extension_unavailable" });
    else bridgeResult(result);
  });
});

reportStatus(null);
