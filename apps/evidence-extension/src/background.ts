type EvidenceSource = "facebook" | "linkedin" | "github";
type BridgeCommand = { type: "PYTORCH_PH_COLLECT_ACTIVE"; requestId: string; source: EvidenceSource };

const sourceHost = {
  facebook: /(^|\.)facebook\.com$/,
  linkedin: /(^|\.)linkedin\.com$/,
  github: /^github\.com$/,
} satisfies Record<EvidenceSource, RegExp>;

function matchesSource(url: string | undefined, source: EvidenceSource) {
  if (!url) return false;
  try { return new URL(url).protocol === "https:" && sourceHost[source].test(new URL(url).hostname); }
  catch { return false; }
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  const command = message as Partial<BridgeCommand>;
  if (command.type !== "PYTORCH_PH_COLLECT_ACTIVE" || typeof command.requestId !== "string" || !command.source || !(command.source in sourceHost)) return;
  chrome.tabs.query({}, (tabs) => {
    const tab = tabs.filter((candidate) => matchesSource(candidate.url, command.source!)).sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0];
    if (!tab?.id) {
      respond({ ok: false, requestId: command.requestId, code: "source_tab_missing", humanGate: true });
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "PYTORCH_PH_COLLECT_PAGE", requestId: command.requestId }, (result) => {
      if (chrome.runtime.lastError) respond({ ok: false, requestId: command.requestId, code: "collector_unavailable" });
      else respond(result);
    });
  });
  return true;
});
