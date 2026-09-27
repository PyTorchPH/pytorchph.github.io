import type { CapabilityKey } from "@pytorch-ph/domain-protocol/identity";

type PreviewCapability = { state: "available" | "locked"; reason: string; missing: string[] };
const preview: PreviewCapability = { state: "available", reason: "Static demo only", missing: [] };
export function useCapabilities(): { capabilities: Record<CapabilityKey, PreviewCapability> } {
  return { capabilities: new Proxy({} as Record<CapabilityKey, PreviewCapability>, { get: () => preview }) };
}
