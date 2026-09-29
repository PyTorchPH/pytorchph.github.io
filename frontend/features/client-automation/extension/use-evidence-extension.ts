"use client";

// React view of the extension's presence.
// Module map (caller-first):
//   useEvidenceExtension  probes once on mount, then reports available/outdated/missing
//   isStatusReply         validates a status reply's shape
//   emitStatusEvent       reports detection or absence once per page

import { useEffect, useState } from "react";
import { PROBE_TIMEOUT_MS, readStatusReply, type ExtensionStatus } from "./status";

const emittedStatusEvents = new Set<string>();

// Mental model: probe on mount; a valid reply marks the extension available, silence past the timeout marks it missing.
export function useEvidenceExtension(): ExtensionStatus {
  const [status, setStatus] = useState<ExtensionStatus>({ state: "checking", capabilities: [] });
  useEffect(() => {
    const nonce = crypto.randomUUID();
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.nonce !== nonce && detail?.nonce !== null) return;
      if (!isStatusReply(detail)) return;
      setStatus(readStatusReply(detail.version, detail.capabilities));
      emitStatusEvent("extension.detected", "succeeded");
    };
    window.addEventListener("PYTORCH_PH_EXTENSION_STATUS", handler);
    window.dispatchEvent(new CustomEvent("PYTORCH_PH_EXTENSION_PROBE", { detail: { nonce } }));
    const timer = window.setTimeout(() => setStatus((current) => {
      if (current.state !== "checking") return current;
      emitStatusEvent("extension.missing", "stopped");
      return { state: "missing", capabilities: [] };
    }), PROBE_TIMEOUT_MS);
    return () => { window.clearTimeout(timer); window.removeEventListener("PYTORCH_PH_EXTENSION_STATUS", handler); };
  }, []);
  return status;
}

function isStatusReply(detail: { version?: unknown; capabilities?: unknown } | undefined): detail is { version: string; capabilities: string[] } {
  return typeof detail?.version === "string" && Array.isArray(detail.capabilities) && detail.capabilities.every((value: unknown) => typeof value === "string");
}

function emitStatusEvent(code: "extension.detected" | "extension.missing", outcome: "succeeded" | "stopped") {
  if (emittedStatusEvents.has(code)) return;
  emittedStatusEvents.add(code);
  window.dispatchEvent(new CustomEvent("PYTORCH_PH_OPERATIONAL_EVENT", { detail: { code, outcome } }));
}
