// The member's own AI provider, stored and called by the extension (never by PyTorch PH servers).
// Module map (caller-first):
//   aiStatus         reads the stored connection (no key), or null without the extension
//   aiConfigure      saves the connection in the extension
//   aiClear          removes the stored key
//   aiComplete       runs one completion through the member's provider
//   localAICommand   sends one local-AI command with JSON-string payloads

import { sendExtensionCommand, type CommandResult } from "./bridge";
import { emitOperational, extensionSupports, probeExtension } from "./status";

export type LocalAIConfig = { provider: string; model: string; apiKey?: string; baseUrl?: string; apiVersion?: string; project?: string; region?: string };
export type LocalAIStatus = { configured: boolean; provider: string; model: string; baseUrl: string; apiKeyPresent: boolean; apiVersion: string; project: string; region: string; permissionNeeded: string | null };

const AI_STATUS_TIMEOUT_MS = 5_000;
const AI_COMPLETE_TIMEOUT_MS = 75_000;
const LOCAL_AI_MISSING = "Install or update the PyTorch PH extension to use your own AI key. Keys stay in the extension, never on PyTorch PH servers.";

/** Local AI connection stored in the extension, or null when the extension is absent or too old. */
export async function aiStatus(): Promise<LocalAIStatus | null> {
  try {
    const result = await localAICommand("ai_status", {}, AI_STATUS_TIMEOUT_MS);
    return (result.status as LocalAIStatus) ?? null;
  } catch {
    return null;
  }
}

/** Saves the AI connection in the extension only. A blank key keeps the stored one for the same provider. */
export async function aiConfigure(config: LocalAIConfig): Promise<LocalAIStatus> {
  const result = await localAICommand("ai_configure", { config }, AI_STATUS_TIMEOUT_MS);
  emitOperational("local_ai.configured", "succeeded");
  return result.status as LocalAIStatus;
}

export async function aiClear(): Promise<void> {
  await localAICommand("ai_clear", {}, AI_STATUS_TIMEOUT_MS);
  emitOperational("local_ai.cleared", "succeeded");
}

/** Runs one completion through the member's own provider, called from the extension. */
export async function aiComplete(request: { system?: string; prompt: string; maxTokens?: number; json?: boolean }): Promise<string> {
  const result = await localAICommand("ai_complete", { request }, AI_COMPLETE_TIMEOUT_MS);
  if (typeof result.text !== "string") throw new Error("The AI provider returned an empty answer.");
  emitOperational("local_ai.completed", "succeeded");
  return result.text;
}

// Mental model: check support, stringify the payload, send, and turn a refused reply into an Error.
// Payloads cross into the extension as JSON strings; replies carry status or text, never the key.
async function localAICommand(action: string, payload: Record<string, unknown>, timeoutMs: number): Promise<CommandResult> {
  if (!extensionSupports(await probeExtension(), "local_ai")) throw new Error(LOCAL_AI_MISSING);
  const body = Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, JSON.stringify(value)]));
  const result = await sendExtensionCommand(action, body, timeoutMs);
  if (!result.ok) {
    emitOperational(`local_ai.${action}.failed`, "failed");
    throw new Error(typeof result.message === "string" ? result.message : "The local AI request failed.");
  }
  return result;
}
