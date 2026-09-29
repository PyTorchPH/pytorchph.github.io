"use client";

import { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Capability, CapabilityKey, CapabilityManifest } from "@pytorch-ph/domain-protocol/identity";
import { signedInCapabilityManifest } from "@pytorch-ph/domain-protocol/identity";
import { aiStatus } from "@pytorch-ph/domain-client/client-automation";
import { fetchJson, queryKeys } from "@pytorch-ph/domain-client/transport";

const CapabilityContext = createContext<CapabilityManifest>(signedInCapabilityManifest());
const AI_REQUIREMENT = "AI endpoint and model";

// The AI provider lives in the member's extension, so the server cannot know it is configured;
// the portal clears that one requirement locally and keeps every other gate.
function withLocalAI(manifest: CapabilityManifest, localAIReady: boolean): CapabilityManifest {
  if (!localAIReady) return manifest;
  const capabilities = Object.fromEntries(Object.entries(manifest.capabilities).map(([key, capability]) => {
    if (capability.state !== "locked" || !capability.missing.includes(AI_REQUIREMENT)) return [key, capability];
    const missing = capability.missing.filter((item) => item !== AI_REQUIREMENT);
    const next: Capability = missing.length
      ? { state: "locked", reason: `Your AI connection is ready; still required: ${missing.join(", ")}.`, missing }
      : { state: "available", reason: "Uses the AI provider stored in your PyTorch PH extension.", missing: [] };
    return [key, next];
  })) as CapabilityManifest["capabilities"];
  return { ...manifest, capabilities };
}

export function CapabilityProvider({ children }: { children: React.ReactNode }) {
  const query = useQuery({ queryKey: queryKeys.capabilities, queryFn: () => fetchJson<CapabilityManifest>("/api/capabilities", { cache: "no-store" }) });
  const localAI = useQuery({ queryKey: ["local-ai-status"], queryFn: aiStatus, staleTime: 60_000 });
  const ready = Boolean(localAI.data?.configured && !localAI.data.permissionNeeded);
  const value = useMemo(() => withLocalAI(query.data || signedInCapabilityManifest(), ready), [query.data, ready]);
  return <CapabilityContext.Provider value={value}>{children}</CapabilityContext.Provider>;
}

export function useCapability(key: CapabilityKey): Capability {
  return useContext(CapabilityContext).capabilities[key];
}

export function useCapabilities(): CapabilityManifest {
  return useContext(CapabilityContext);
}
