export type AuthenticationProvider = "local" | "supabase";

function hostname(value: string | null | undefined) {
  const raw = (value || "").trim().toLowerCase();
  if (raw.startsWith("[")) return raw.slice(1, raw.indexOf("]"));
  return raw.split(":", 1)[0];
}

export function isLoopbackHost(value: string | null | undefined) {
  const host = hostname(value);
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
}

export function authenticationProvider(value: string | null | undefined): AuthenticationProvider {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.CI) return "supabase";
  return isLoopbackHost(value) ? "local" : "supabase";
}
