"use client";

import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Capability, CapabilityKey, CapabilityManifest } from "@pytorch-ph/domain-protocol/identity";
import { lockedCapabilityManifest } from "@pytorch-ph/domain-protocol/identity";
import { fetchJson, queryKeys } from "@pytorch-ph/domain-client/transport";

const CapabilityContext = createContext<CapabilityManifest>(lockedCapabilityManifest());

export function CapabilityProvider({ children }: { children: React.ReactNode }) {
  const query = useQuery({ queryKey: queryKeys.capabilities, queryFn: () => fetchJson<CapabilityManifest>("/api/capabilities", { cache: "no-store" }) });
  return <CapabilityContext.Provider value={query.data || lockedCapabilityManifest()}>{children}</CapabilityContext.Provider>;
}

export function useCapability(key: CapabilityKey): Capability {
  return useContext(CapabilityContext).capabilities[key];
}

export function useCapabilities(): CapabilityManifest {
  return useContext(CapabilityContext);
}
