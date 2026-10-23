// Talking to the PyTorch PH API for sign-in and registration.
// Module map (caller-first):
//   officialAuth       POSTs credentials and returns the parsed reply, or throws its error
//   readSignedInViewer the viewer for an existing session, or null
//   hasAuthApi, hasGoogleSignIn, isStaticDemo  what this deployment supports

export const API_ORIGIN = (process.env.NEXT_PUBLIC_AUTH_API_ORIGIN ?? process.env.NEXT_PUBLIC_API_ORIGIN ?? "").replace(/\/$/, "");
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "1";

export type OfficialViewer = { role: string };
type AuthOperation = "signup" | "password" | "verification" | "google" | "authentication";
type AuthFailureReason = "http" | "network" | "invalid_response";

export class OfficialAuthError extends Error {
  constructor(
    public readonly operation: AuthOperation,
    public readonly status: number | null,
    public readonly reason: AuthFailureReason = "http",
  ) {
    super(authErrorMessage(operation, status, reason));
    this.name = "OfficialAuthError";
  }
}

// Mental model: send the unchanged credential contract, classify failures without reading private error bodies, then validate success.
export async function officialAuth<T = unknown>(
  path: string,
  body: unknown,
  request: typeof fetch = fetch,
): Promise<T> {
  const operation = authOperation(path);
  let response: Response;
  try {
    response = await request(`${API_ORIGIN}${path}`, { method: "POST", credentials: "include", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw authFailure(operation, null, "network");
  }
  if (!response.ok) throw authFailure(operation, response.status, "http");
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw authFailure(operation, response.status, "invalid_response");
  }
  if (!isSuccessfulAuthReply(operation, result)) throw authFailure(operation, response.status, "invalid_response");
  return result as T;
}

function authOperation(path: string): AuthOperation {
  switch (path) {
    case "/auth/email/start": return "signup";
    case "/auth/password": return "password";
    case "/auth/email/verify": return "verification";
    case "/auth/google": return "google";
    default: return "authentication";
  }
}

function authFailure(
  operation: AuthOperation,
  status: number | null,
  reason: AuthFailureReason,
): OfficialAuthError {
  console.warn({ event: "auth.client.request_failed", component: "auth-client", operation, status, reason });
  return new OfficialAuthError(operation, status, reason);
}

function authErrorMessage(
  operation: AuthOperation,
  status: number | null,
  reason: AuthFailureReason,
): string {
  const action = operation === "signup" ? "registration" : operation === "verification" ? "email verification" : operation === "google" ? "Google sign-in" : "sign-in";
  const emailNotice = operation === "signup" ? " Hindi ito nangangahulugang invalid o taken ang email mo." : "";
  if (reason === "network") return `Hindi makakonekta sa ${action} service. Tingnan ang connection mo at subukan ulit.${emailNotice}`;
  if (reason === "invalid_response") return `Hindi makumpirma ang sagot ng ${action} service (${status}). Subukan ulit; kung hindi pa rin gumana, i-report ang status na ito.`;
  if (status === 429) return `Masyadong maraming ${action} attempt (429). Maghintay bago subukan ulit.`;
  if (status !== null && status >= 500) return `Pansamantalang unavailable ang ${action} service (${status}).${emailNotice} Subukan ulit mamaya.`;
  if (operation === "password" && status === 401) return "Hindi tama ang email o password (401). Subukan ulit o gumawa ng account kung wala ka pa.";
  if (operation === "verification" && status !== null && [400, 401, 409, 410, 422].includes(status)) {
    return `Hindi tinanggap ang verification code o link (${status}). Suriin ang code o humiling ng bagong verification email.`;
  }
  if (operation === "signup" && status !== null && [400, 409, 422].includes(status)) {
    return `Hindi natuloy ang registration (${status}). Suriin ang email, buong pangalan, username, at password requirements.`;
  }
  if (status === 403) return `Hindi pinayagan ang ${action} request (403). I-refresh ang page at subukan ulit.`;
  return `Hindi natuloy ang ${action} (${status}). Subukan ulit; kung hindi pa rin gumana, i-report ang status na ito.`;
}

function isSuccessfulAuthReply(operation: AuthOperation, result: unknown): boolean {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return false;
  if (operation === "signup") return "message" in result && typeof result.message === "string" && result.message.trim().length > 0;
  return operation === "authentication" || isViewerReply(result);
}

function isViewerReply(result: unknown): result is OfficialViewer {
  return typeof result === "object" && result !== null && "role" in result
    && typeof result.role === "string" && result.role.trim().length > 0;
}

export async function readSignedInViewer(signal: AbortSignal): Promise<OfficialViewer | null> {
  const response = await fetch(`${API_ORIGIN}/auth/me`, { credentials: "include", cache: "no-store", signal });
  if (!response.ok) return null;
  const result: unknown = await response.json().catch(() => null);
  return isViewerReply(result) ? result : null;
}

export const hasAuthApi = () => Boolean(API_ORIGIN);
export const hasGoogleSignIn = () => Boolean(GOOGLE_CLIENT_ID);
export const isStaticDemo = () => STATIC_DEMO;
