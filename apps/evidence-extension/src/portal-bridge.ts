const VERSION = chrome.runtime.getManifest().version;
const CAPABILITIES = ["facebook", "linkedin", "github"];

function reportStatus(nonce: unknown) {
  window.dispatchEvent(new CustomEvent("PYTORCH_PH_EXTENSION_STATUS", {
    detail: { nonce, state: "available", version: VERSION, capabilities: CAPABILITIES },
  }));
}

window.addEventListener("PYTORCH_PH_EXTENSION_PROBE", (event) => reportStatus((event as CustomEvent).detail?.nonce));
window.addEventListener("PYTORCH_PH_EXTENSION_COMMAND", (event) => {
  const detail = (event as CustomEvent).detail;
  if (!detail || detail.action !== "collect_active" || typeof detail.requestId !== "string" || !CAPABILITIES.includes(detail.source)) return;
  chrome.runtime.sendMessage({ type: "PYTORCH_PH_COLLECT_ACTIVE", requestId: detail.requestId, source: detail.source }, (result) => {
    window.dispatchEvent(new CustomEvent("PYTORCH_PH_EXTENSION_RESULT", { detail: result }));
  });
});

reportStatus(null);
