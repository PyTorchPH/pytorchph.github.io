"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LockKeyhole, Puzzle } from "lucide-react";
import { Button } from "@pytorch-ph/design-system/button";
import type { EvidenceSubmissionEnvelope } from "@pytorch-ph/domain-protocol/career-evidence";

export type ExtensionStatus = {
  state: "checking" | "available" | "outdated" | "missing" | "permission_required" | "error";
  version?: string;
  capabilities: string[];
};

const minimumVersion = "0.1.0";
const emittedStatusEvents = new Set<string>();

function emitStatusEvent(code: "extension.detected" | "extension.missing", outcome: "succeeded" | "stopped") {
  if (emittedStatusEvents.has(code)) return;
  emittedStatusEvents.add(code);
  window.dispatchEvent(new CustomEvent("PYTORCH_PH_OPERATIONAL_EVENT", { detail: { code, outcome } }));
}

function versionBefore(value: string, minimum: string) {
  const current = value.split(".").map(Number);
  const required = minimum.split(".").map(Number);
  return required.some((part, index) => (current[index] || 0) !== part && (current[index] || 0) < part && required.slice(0, index).every((prior, priorIndex) => (current[priorIndex] || 0) === prior));
}

export function useEvidenceExtension(): ExtensionStatus {
  const [status, setStatus] = useState<ExtensionStatus>({ state: "checking", capabilities: [] });
  useEffect(() => {
    const nonce = crypto.randomUUID();
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.nonce !== nonce && detail?.nonce !== null) return;
      if (typeof detail?.version !== "string" || !Array.isArray(detail.capabilities) || !detail.capabilities.every((value: unknown) => typeof value === "string")) return;
      setStatus({ state: versionBefore(detail.version, minimumVersion) ? "outdated" : "available", version: detail.version, capabilities: detail.capabilities });
      emitStatusEvent("extension.detected", "succeeded");
    };
    window.addEventListener("PYTORCH_PH_EXTENSION_STATUS", handler);
    window.dispatchEvent(new CustomEvent("PYTORCH_PH_EXTENSION_PROBE", { detail: { nonce } }));
    const timer = window.setTimeout(() => setStatus((current) => {
      if (current.state !== "checking") return current;
      emitStatusEvent("extension.missing", "stopped");
      return { state: "missing", capabilities: [] };
    }), 900);
    return () => { window.clearTimeout(timer); window.removeEventListener("PYTORCH_PH_EXTENSION_STATUS", handler); };
  }, []);
  return status;
}

export function collectEvidenceFromExtension(source: "facebook" | "linkedin" | "github"): Promise<EvidenceSubmissionEnvelope> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const emit = (code: string, outcome: "succeeded" | "stopped" | "failed") => window.dispatchEvent(new CustomEvent("PYTORCH_PH_OPERATIONAL_EVENT", { detail: { code, outcome } }));
    const timer = window.setTimeout(() => { cleanup(); emit("scrape.timeout", "failed"); reject(new Error("The extension did not respond. Reopen the source page and try again.")); }, 10_000);
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.requestId !== requestId) return;
      cleanup();
      if (!detail.ok) {
        const messages: Record<string, string> = {
          source_tab_missing: `Open a visible ${source} page in this browser, then try again.`,
          login_required: `Sign in to ${source} in the visible source tab, then try again.`,
          verification_required: "Complete the visible verification or CAPTCHA yourself, then try again.",
          rate_limited: "The site is rate limiting this session. Wait before trying again.",
          unsupported_page: "Open an explicit Facebook or LinkedIn evidence post, or a bounded GitHub profile/repository page.",
          layout_drift: "The rendered layout did not match the verified adapter. Collection stopped for review.",
        };
        emit(`scrape.${typeof detail.code === "string" ? detail.code : "failed"}`, detail.humanGate ? "stopped" : "failed");
        reject(new Error(messages[detail.code] || "Evidence collection stopped safely."));
        return;
      }
      emit("scrape.preview_ready", "succeeded");
      resolve(detail.preview as EvidenceSubmissionEnvelope);
    };
    const cleanup = () => { window.clearTimeout(timer); window.removeEventListener("PYTORCH_PH_EXTENSION_RESULT", handler); };
    window.addEventListener("PYTORCH_PH_EXTENSION_RESULT", handler);
    window.dispatchEvent(new CustomEvent("PYTORCH_PH_EXTENSION_COMMAND", { detail: { action: "collect_active", requestId, source } }));
  });
}

export function ExtensionCapabilityOverlay({ children, capability = "evidence collection", requiredCapability }: { children: React.ReactNode; capability?: string; requiredCapability?: string }) {
  const status = useEvidenceExtension();
  const available = status.state === "available" && (!requiredCapability || status.capabilities.includes(requiredCapability));
  if (available) return <>{children}</>;
  return <div className="relative overflow-hidden rounded-xl" data-extension-state={status.state}>
    <div aria-hidden="true" className="pointer-events-none opacity-30">{children}</div>
    <div className="absolute inset-0 flex items-center justify-center bg-surface/90 p-4 text-center backdrop-blur-sm">
      <div><Puzzle className="mx-auto text-accent" size={24}/><p className="mt-3 font-semibold">{status.state === "checking" ? "Checking extension…" : `${capability} unavailable`}</p><p className="mt-1 text-sm text-muted">Install or update the developer extension. Other resume features remain available.</p>{status.state !== "checking" && <Button asChild className="mt-4"><Link href="/setup/evidence-extension"><LockKeyhole size={15}/>View installation steps</Link></Button>}</div>
    </div>
  </div>;
}
