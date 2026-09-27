// Aliased in place of @pytorch-ph/domain-client/identity for the static demo only.
// Re-exports the real identity UI and swaps the Supabase browser client for a stub,
// so registration and Google sign-in explain the demo instead of failing on missing config.
import type { createSupabaseBrowserClient as RealClientFactory } from "../../../domains/client/identity/session/create-browser-client";

export * from "../../../domains/client/identity/index";

const DISABLED_MESSAGE = "Account creation and Google sign-in are disabled in this static demo. Use an example account from the demo bar below.";

export function createSupabaseBrowserClient() {
  const disabled = async () => ({ data: { user: null, session: null, provider: null, url: null }, error: new Error(DISABLED_MESSAGE) });
  return { auth: { signUp: disabled, signInWithOAuth: disabled } } as unknown as ReturnType<typeof RealClientFactory>;
}
