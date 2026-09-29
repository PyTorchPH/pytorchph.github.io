// Talking to the PyTorch PH API for sign-in and registration.
// Module map (caller-first):
//   officialAuth       POSTs credentials and returns the parsed reply, or throws its error
//   readSignedInViewer the viewer for an existing session, or null
//   hasAuthApi, hasGoogleSignIn, isStaticDemo  what this deployment supports

export const API_ORIGIN = (process.env.NEXT_PUBLIC_AUTH_API_ORIGIN ?? process.env.NEXT_PUBLIC_API_ORIGIN ?? "").replace(/\/$/, "");
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "1";

export type OfficialViewer = { role: string };

export async function officialAuth<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Authentication failed.");
  return result as T;
}

export async function readSignedInViewer(signal: AbortSignal): Promise<OfficialViewer | null> {
  const response = await fetch(`${API_ORIGIN}/auth/me`, { credentials: "include", cache: "no-store", signal });
  if (!response.ok) return null;
  return await response.json() as OfficialViewer;
}

export const hasAuthApi = () => Boolean(API_ORIGIN);
export const hasGoogleSignIn = () => Boolean(GOOGLE_CLIENT_ID);
export const isStaticDemo = () => STATIC_DEMO;
