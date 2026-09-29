// Extension presence and version.
// Module map (caller-first):
//   probeExtension      one-shot probe for code outside React
//   extensionSupports   is the extension installed, current, and offering a capability?
//   readStatusReply     turns a PYTORCH_PH_EXTENSION_STATUS reply into an ExtensionStatus
//   versionBefore       semantic "older than" check against the minimum version
//   emitOperational     reports a browser operational event

export type ExtensionStatus = {
  state: "checking" | "available" | "outdated" | "missing" | "permission_required" | "error";
  version?: string;
  capabilities: string[];
};

export const MINIMUM_VERSION = "0.1.0";
export const PROBE_TIMEOUT_MS = 900;

// Mental model: shout "who is there?" once, accept the first matching reply, give up after the timeout.
// One-shot probe for code outside React (bug reports, background actions).
export function probeExtension(): Promise<ExtensionStatus> {
  return new Promise((resolve) => {
    const nonce = crypto.randomUUID();
    const done = (status: ExtensionStatus) => { window.clearTimeout(timer); window.removeEventListener("PYTORCH_PH_EXTENSION_STATUS", handler); resolve(status); };
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.nonce !== nonce || typeof detail.version !== "string" || !Array.isArray(detail.capabilities)) return;
      done(readStatusReply(detail.version, detail.capabilities.filter((value: unknown) => typeof value === "string")));
    };
    const timer = window.setTimeout(() => done({ state: "missing", capabilities: [] }), PROBE_TIMEOUT_MS);
    window.addEventListener("PYTORCH_PH_EXTENSION_STATUS", handler);
    window.dispatchEvent(new CustomEvent("PYTORCH_PH_EXTENSION_PROBE", { detail: { nonce } }));
  });
}

export function extensionSupports(status: ExtensionStatus, capability: string) {
  return status.state === "available" && status.capabilities.includes(capability);
}

export function readStatusReply(version: string, capabilities: string[]): ExtensionStatus {
  return { state: versionBefore(version, MINIMUM_VERSION) ? "outdated" : "available", version, capabilities };
}

export function versionBefore(value: string, minimum: string) {
  const current = value.split(".").map(Number);
  const required = minimum.split(".").map(Number);
  return required.some((part, index) => (current[index] || 0) !== part && (current[index] || 0) < part && required.slice(0, index).every((prior, priorIndex) => (current[priorIndex] || 0) === prior));
}

export function emitOperational(code: string, outcome: "succeeded" | "stopped" | "failed") {
  window.dispatchEvent(new CustomEvent("PYTORCH_PH_OPERATIONAL_EVENT", { detail: { code, outcome } }));
}
