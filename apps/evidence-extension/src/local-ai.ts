// Local AI: the member's provider key lives only in chrome.storage.local and is sent only to
// the provider they chose. The portal can ask for a completion or the status, never the key.

export type LocalAIConfig = { provider: string; model: string; apiKey?: string; baseUrl?: string; apiVersion?: string; project?: string; region?: string };
export type LocalAIStatus = { configured: boolean; provider: string; model: string; baseUrl: string; apiKeyPresent: boolean; apiVersion: string; project: string; region: string; permissionNeeded: string | null };
export type CompletionRequest = { system?: string; prompt: string; maxTokens?: number; json?: boolean };

type StoredConfig = Required<Pick<LocalAIConfig, "provider" | "model">> & { apiKey: string; baseUrl: string; apiVersion: string; project: string; region: string };

const STORAGE_KEY = "pytorchPhLocalAI";
const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 1024;
const MAX_PROMPT_CHARS = 100_000;
const AZURE_API_VERSION = "2024-10-21";
const PROVIDERS = ["google", "anthropic", "openai", "openrouter", "openai-compatible", "ollama", "azure", "other"] as const;
const KEY_REQUIRED = new Set(["google", "anthropic", "openai", "openrouter", "azure"]);
const BASE_URL_REQUIRED = new Set(["openai-compatible", "azure", "other"]);
const FIXED_BASE: Record<string, string> = { openai: "https://api.openai.com/v1", openrouter: "https://openrouter.ai/api/v1" };
const OLLAMA_DEFAULT = "http://localhost:11434";

/** A readable failure the portal shows as-is; it never contains the key. */
export class LocalAIError extends Error {}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new LocalAIError("Enter a valid API base URL."); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname))) {
    throw new LocalAIError("The API base URL must use https (http is allowed only for localhost).");
  }
  return url.href.replace(/\/+$/, "");
}

async function readStored(): Promise<StoredConfig | null> {
  const value = (await chrome.storage.local.get([STORAGE_KEY]))[STORAGE_KEY];
  return value && typeof value === "object" ? value as StoredConfig : null;
}

// Custom endpoints need an optional host permission that only the popup can request.
function endpointOrigin(config: StoredConfig): string | null {
  if (!config.baseUrl) return null;
  const origin = new URL(config.baseUrl).origin;
  const fixed = ["https://generativelanguage.googleapis.com", "https://api.anthropic.com", "https://api.openai.com", "https://openrouter.ai"];
  return fixed.includes(origin) ? null : `${origin}/*`;
}

async function missingPermission(config: StoredConfig): Promise<string | null> {
  const pattern = endpointOrigin(config);
  if (!pattern) return null;
  return (await chrome.permissions.contains({ origins: [pattern] })) ? null : pattern;
}

function toStatus(config: StoredConfig | null, permissionNeeded: string | null): LocalAIStatus {
  return {
    configured: Boolean(config),
    provider: config?.provider ?? "",
    model: config?.model ?? "",
    baseUrl: config?.baseUrl ?? "",
    apiKeyPresent: Boolean(config?.apiKey),
    apiVersion: config?.apiVersion ?? "",
    project: config?.project ?? "",
    region: config?.region ?? "",
    permissionNeeded,
  };
}

export async function aiStatus(): Promise<LocalAIStatus> {
  const config = await readStored();
  return toStatus(config, config ? await missingPermission(config) : null);
}

export async function aiConfigure(input: LocalAIConfig): Promise<LocalAIStatus> {
  const provider = String(input.provider || "");
  if (!(PROVIDERS as readonly string[]).includes(provider)) throw new LocalAIError("Choose a supported AI provider.");
  const model = String(input.model || "").trim();
  if (model.length < 1 || model.length > 200) throw new LocalAIError("Enter a model name (1–200 characters).");
  const previous = await readStored();
  const typedKey = String(input.apiKey || "").trim();
  // A blank key keeps the stored one only when the provider did not change.
  const apiKey = typedKey || (previous?.provider === provider ? previous.apiKey : "");
  if (apiKey.length > 500) throw new LocalAIError("The API key is too long.");
  const rawBase = String(input.baseUrl || "").trim() || (provider === "ollama" ? OLLAMA_DEFAULT : "");
  if (BASE_URL_REQUIRED.has(provider) && !rawBase) throw new LocalAIError("This provider needs an API base URL.");
  if (KEY_REQUIRED.has(provider) && !apiKey) throw new LocalAIError("This provider needs an API key.");
  const baseUrl = FIXED_BASE[provider] ?? (rawBase ? normalizeBaseUrl(rawBase) : "");
  const short = (value: unknown) => String(value || "").trim().slice(0, 100);
  const config: StoredConfig = { provider, model, apiKey, baseUrl, apiVersion: short(input.apiVersion), project: short(input.project), region: short(input.region) };
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
  return toStatus(config, await missingPermission(config));
}

export async function aiClear(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

type HttpCall = { url: string; headers: Record<string, string>; body: unknown; read: (payload: Record<string, unknown>) => string };

function openAiCall(config: StoredConfig, base: string, request: CompletionRequest, maxTokens: number): HttpCall {
  const messages = [...(request.system ? [{ role: "system", content: request.system }] : []), { role: "user", content: request.prompt }];
  return {
    url: `${base}/chat/completions`,
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    body: { model: config.model, messages, max_tokens: maxTokens, ...(request.json ? { response_format: { type: "json_object" } } : {}) },
    read: (payload) => String((payload.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content ?? ""),
  };
}

function buildCall(config: StoredConfig, request: CompletionRequest): HttpCall {
  const maxTokens = Math.min(Math.max(Math.round(request.maxTokens || DEFAULT_MAX_TOKENS), 1), 8192);
  switch (config.provider) {
    case "google":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
        headers: {},
        body: {
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
          generationConfig: { maxOutputTokens: maxTokens, ...(request.json ? { responseMimeType: "application/json" } : {}) },
        },
        read: (payload) => ((payload.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined)?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join(""),
      };
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: { model: config.model, max_tokens: maxTokens, ...(request.system ? { system: request.system } : {}), messages: [{ role: "user", content: request.prompt }] },
        read: (payload) => ((payload.content as Array<{ type?: string; text?: string }> | undefined) ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join(""),
      };
    case "azure": {
      const call = openAiCall({ ...config, apiKey: "" }, "", request, maxTokens);
      const { model: _deployment, ...body } = call.body as Record<string, unknown>;
      return {
        ...call,
        url: `${config.baseUrl}/openai/deployments/${encodeURIComponent(config.model)}/chat/completions?api-version=${encodeURIComponent(config.apiVersion || AZURE_API_VERSION)}`,
        headers: { "api-key": config.apiKey },
        body,
      };
    }
    case "ollama":
      return openAiCall(config, `${config.baseUrl || OLLAMA_DEFAULT}/v1`, request, maxTokens);
    default:
      return openAiCall(config, config.baseUrl, request, maxTokens);
  }
}

export async function aiComplete(request: CompletionRequest): Promise<string> {
  const config = await readStored();
  if (!config) throw new LocalAIError("Set up your AI connection in the portal's Settings first.");
  if (typeof request?.prompt !== "string" || !request.prompt.trim()) throw new LocalAIError("The AI request is empty.");
  if (request.prompt.length > MAX_PROMPT_CHARS || (request.system?.length ?? 0) > MAX_PROMPT_CHARS) throw new LocalAIError("The AI request is too long.");
  const permission = await missingPermission(config);
  if (permission) throw new LocalAIError(`Open the PyTorch PH extension and allow access to ${permission.replace(/\/\*$/, "")}.`);
  const call = buildCall(config, request);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(call.url, { method: "POST", headers: { "Content-Type": "application/json", ...call.headers }, body: JSON.stringify(call.body), signal: controller.signal });
  } catch {
    throw new LocalAIError(controller.signal.aborted ? "The AI endpoint took too long to answer." : "Could not reach the AI endpoint.");
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403) throw new LocalAIError("The AI provider rejected the key.");
  if (response.status === 429) throw new LocalAIError("The AI provider is rate limiting this key. Wait before trying again.");
  if (response.status === 404) throw new LocalAIError("The AI provider could not find that model or endpoint.");
  if (!response.ok) throw new LocalAIError(`The AI provider returned an error (${response.status}).`);
  let payload: Record<string, unknown>;
  try { payload = await response.json() as Record<string, unknown>; } catch { throw new LocalAIError("The AI provider returned an unreadable answer."); }
  const text = call.read(payload).trim();
  if (!text) throw new LocalAIError("The AI provider returned an empty answer.");
  return text;
}
