// Which external account is signed in to this browser.
// Module map (caller-first):
//   verifyIdentity     asks the extension to read the signed-in account for a provider
//   isVerifiedIdentity validates the identity the extension returned

import { commandError, sendExtensionCommand, type ExtensionProvider } from "./bridge";
import { emitOperational, extensionSupports, probeExtension } from "./status";

export type VerifiedIdentity = { provider: ExtensionProvider; handle: string; profileUrl: string };

const VERIFY_TIMEOUT_MS = 45_000;

// Mental model: the extension opens the provider in the member's own session and reports who is signed in.
/** Reads which account is signed in to the provider in this browser. */
export async function verifyIdentity(provider: ExtensionProvider): Promise<VerifiedIdentity> {
  if (!extensionSupports(await probeExtension(), "verify_identity")) throw commandError("extension_unavailable");
  const result = await sendExtensionCommand("verify_identity", { provider }, VERIFY_TIMEOUT_MS);
  const identity = result.identity as Partial<VerifiedIdentity> | undefined;
  if (!result.ok || !isVerifiedIdentity(identity, provider)) {
    emitOperational(`extension.verify.${result.code || "failed"}`, result.humanGate ? "stopped" : "failed");
    throw commandError(result.code, provider);
  }
  emitOperational("extension.verify.succeeded", "succeeded");
  return { provider, handle: identity.handle, profileUrl: identity.profileUrl };
}

function isVerifiedIdentity(identity: Partial<VerifiedIdentity> | undefined, provider: ExtensionProvider): identity is VerifiedIdentity {
  return identity?.provider === provider && typeof identity.handle === "string" && typeof identity.profileUrl === "string";
}
