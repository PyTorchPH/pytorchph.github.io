"use client";

// Dims a feature and explains how to install the extension when it is unavailable.
// Module map (caller-first):
//   ExtensionCapabilityOverlay  renders children, or children behind the install notice
//   InstallNotice               the notice with a link to installation steps

import Link from "next/link";
import { LockKeyhole, Puzzle } from "lucide-react";
import { Button } from "@pytorch-ph/design-system/button";
import { useEvidenceExtension } from "./use-evidence-extension";
import type { ExtensionStatus } from "./status";

// Mental model: show the feature when the extension can serve it; otherwise keep it visible but dimmed behind the notice.
export function ExtensionCapabilityOverlay({ children, capability = "evidence collection", requiredCapability }: { children: React.ReactNode; capability?: string; requiredCapability?: string }) {
  const status = useEvidenceExtension();
  const available = status.state === "available" && (!requiredCapability || status.capabilities.includes(requiredCapability));
  if (available) return <>{children}</>;
  return <div className="relative overflow-hidden rounded-xl" data-extension-state={status.state}>
    <div aria-hidden="true" className="pointer-events-none opacity-30">{children}</div>
    <div className="absolute inset-0 flex items-center justify-center bg-surface/90 p-4 text-center backdrop-blur-sm">
      <InstallNotice capability={capability} state={status.state} />
    </div>
  </div>;
}

function InstallNotice({ capability, state }: { capability: string; state: ExtensionStatus["state"] }) {
  return <div><Puzzle className="mx-auto text-accent" size={24}/><p className="mt-3 font-semibold">{state === "checking" ? "Checking extension…" : `${capability} unavailable`}</p><p className="mt-1 text-sm text-muted">Install or update the developer extension. Other resume features remain available.</p>{state !== "checking" && <Button asChild className="mt-4"><Link href="/setup/evidence-extension"><LockKeyhole size={15}/>View installation steps</Link></Button>}</div>;
}
