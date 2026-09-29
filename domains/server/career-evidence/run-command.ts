import { randomUUID } from "node:crypto";
import { manualOpportunitySchema, type EvidenceItem, type EvidenceSource, type Opportunity } from "@pytorch-ph/domain-protocol/career-evidence";
import { configuredProductProvider } from "./select-repository";
import { createLocalEvidence, listLocalOpportunities, saveLocalEvidence, saveLocalMedia, saveLocalOpportunity, saveLocalSourceState } from "./store-local";
import { supportedSourceById } from "./read-source";

export type EvidenceCreateInput = Omit<EvidenceItem, "id">;
export type SourceAction = "connect" | "sync" | "disconnect";

export async function saveManualOpportunity(userId: string, input: unknown): Promise<Opportunity> {
  const value = manualOpportunitySchema.parse(input);
  const id = value.id || randomUUID();
  const opportunity: Opportunity = { ...value, id, recordOrigin: "manual" };
  configuredProductProvider();
  if (value.id && !listLocalOpportunities(userId).some((item) => item.id === value.id)) throw new Error("Manual opportunity is unavailable or not owned by the current user.");
  return saveLocalOpportunity(userId, opportunity);
}


export async function createEvidence(userId: string, input: EvidenceCreateInput): Promise<EvidenceItem> {
  const collectionOrigin = input.sourceId === "manual" ? "manual" as const : input.sourceId === "upload" ? "upload" as const : "automated_scrape" as const;
  const taggedInput = { ...input, collectionOrigin };
  configuredProductProvider();
  return createLocalEvidence(userId, taggedInput);
}

export async function updateEvidence(userId: string, item: EvidenceItem): Promise<EvidenceItem> {
  configuredProductProvider();
  return saveLocalEvidence(userId, item);
}

export async function attachEvidenceMedia(userId: string, item: EvidenceItem, bytes: Uint8Array, mimeType: string): Promise<EvidenceItem> {
  configuredProductProvider();
  saveLocalMedia(userId, item.id, bytes, mimeType);
  return saveLocalEvidence(userId, { ...item, mediaUrl: `/api/product/evidence/media/${item.id}` });
}

export async function applySourceAction(
  userId: string,
  sourceId: string,
  action: SourceAction,
  options: { confirmation?: boolean; url?: string } = {}
): Promise<EvidenceSource> {
  const source = supportedSourceById(sourceId);
  if (!source) throw new Error("Unsupported evidence source.");
  configuredProductProvider();
  if (source.connectionMethod === "url" && action === "connect") {
    try {
      const url = new URL(options.url || "");
      if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
    } catch {
      throw new Error("Enter a valid http or https portfolio URL.");
    }
  }
  if (action === "disconnect" && options.confirmation !== true) throw new Error("Disconnect requires explicit confirmation.");
  const connectionStatus = action === "disconnect" ? "disconnected" as const : "connected" as const;
  const result: EvidenceSource = {
    ...source,
    connectionStatus,
    status: connectionStatus === "connected" ? "verified" : "ready",
    description: `Synthetic local simulation. ${source.description || ""}`,
    lastSyncedAt: action === "sync" ? new Date().toISOString() : source.lastSyncedAt || null,
    configuredUrl: source.connectionMethod === "url" && action === "connect" ? options.url || null : source.configuredUrl || null,
  };
  saveLocalSourceState(userId, { id: sourceId, connectionStatus, lastSyncedAt: result.lastSyncedAt, configuredUrl: result.configuredUrl });
  return result;
}
