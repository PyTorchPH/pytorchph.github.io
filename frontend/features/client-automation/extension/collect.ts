// Evidence collection through the extension.
// Module map (caller-first):
//   collectEvidenceFromExtension  reads the visible source tab the member already opened
//   collectOwnProfile             reads the member's own verified profile (identity re-checked)
//   activeCollectionError         readable message for a failed active-tab collection

import type { EvidenceSubmissionEnvelope } from "@pytorch-ph/domain-protocol/career-evidence";
import { commandError, sendExtensionCommand, type ExtensionProvider } from "./bridge";
import { emitOperational, extensionSupports, probeExtension } from "./status";

export type CollectedPayload = EvidenceSubmissionEnvelope;

const ACTIVE_TIMEOUT_MS = 10_000;
const PROFILE_TIMEOUT_MS = 90_000;

// Mental model: ask the extension to read the tab the member opened; resolve with the preview or reject with a readable reason.
export function collectEvidenceFromExtension(source: "facebook" | "linkedin" | "github"): Promise<EvidenceSubmissionEnvelope> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = window.setTimeout(() => { cleanup(); emitOperational("scrape.timeout", "failed"); reject(new Error("The extension did not respond. Reopen the source page and try again.")); }, ACTIVE_TIMEOUT_MS);
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.requestId !== requestId) return;
      cleanup();
      if (!detail.ok) {
        emitOperational(`scrape.${typeof detail.code === "string" ? detail.code : "failed"}`, detail.humanGate ? "stopped" : "failed");
        reject(activeCollectionError(detail.code, source));
        return;
      }
      emitOperational("scrape.preview_ready", "succeeded");
      resolve(detail.preview as EvidenceSubmissionEnvelope);
    };
    const cleanup = () => { window.clearTimeout(timer); window.removeEventListener("PYTORCH_PH_EXTENSION_RESULT", handler); };
    window.addEventListener("PYTORCH_PH_EXTENSION_RESULT", handler);
    window.dispatchEvent(new CustomEvent("PYTORCH_PH_EXTENSION_COMMAND", { detail: { action: "collect_active", requestId, source } }));
  });
}

/** Collects the member's own verified profile; the extension re-checks the signed-in account first. */
export async function collectOwnProfile(provider: ExtensionProvider, profileUrl: string): Promise<CollectedPayload> {
  if (!extensionSupports(await probeExtension(), "collect_profile")) throw commandError("extension_unavailable");
  const result = await sendExtensionCommand("collect_profile", { provider, profileUrl }, PROFILE_TIMEOUT_MS);
  if (!result.ok || !result.preview) {
    emitOperational(`scrape.profile.${result.code || "failed"}`, result.humanGate ? "stopped" : "failed");
    throw commandError(result.code, provider);
  }
  emitOperational("scrape.profile.preview_ready", "succeeded");
  return result.preview as CollectedPayload;
}

function activeCollectionError(code: unknown, source: string) {
  const messages: Record<string, string> = {
    source_tab_missing: `Open a visible ${source} page in this browser, then try again.`,
    login_required: `Sign in to ${source} in the visible source tab, then try again.`,
    verification_required: "Complete the visible verification or CAPTCHA yourself, then try again.",
    rate_limited: "The site is rate limiting this session. Wait before trying again.",
    unsupported_page: "Open an explicit Facebook or LinkedIn evidence post, or a bounded GitHub profile/repository page.",
    layout_drift: "The rendered layout did not match the verified adapter. Collection stopped for review.",
  };
  return new Error((typeof code === "string" && messages[code]) || "Evidence collection stopped safely.");
}
