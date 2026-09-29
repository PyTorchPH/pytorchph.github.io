// Loopback development uses hashed local SQLite sessions; every deployed host authenticates through the Rust API.
export type AuthenticationProvider = "local" | "rust-api";

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
  if (process.env.NODE_ENV === "production" || process.env.CI) return "rust-api";
  return isLoopbackHost(value) ? "local" : "rust-api";
}
