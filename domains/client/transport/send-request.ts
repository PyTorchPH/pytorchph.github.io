export class HttpError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new HttpError(payload.error || `Request failed with status ${response.status}.`, response.status);
  return payload;
}

export const queryKeys = {
  capabilities: ["capabilities"] as const,
  jobMarket: (query: string) => ["job-market", query] as const,
  product: (view: string) => ["product", view] as const,
};
