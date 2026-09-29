// Command transport between the portal page and the extension's content-script bridge.
// Module map (caller-first):
//   sendExtensionCommand  dispatches one command and waits for its matching result
//   commandError          turns an extension result code into a readable Error

export type ExtensionProvider = "github" | "linkedin" | "facebook";
export type CommandResult = { ok: boolean; code?: string; humanGate?: boolean; [key: string]: unknown };

const providerNames: Record<ExtensionProvider, string> = { github: "GitHub", linkedin: "LinkedIn", facebook: "Facebook" };

// Mental model: every command carries a fresh requestId; only the result echoing it settles the promise.
export function sendExtensionCommand(action: string, payload: Record<string, unknown>, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const cleanup = () => { window.clearTimeout(timer); window.removeEventListener("PYTORCH_PH_EXTENSION_RESULT", handler); };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error("The extension did not respond. Reload the extension and try again.")); }, timeoutMs);
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as CommandResult & { requestId?: string };
      if (detail?.requestId !== requestId) return;
      cleanup();
      resolve(detail);
    };
    window.addEventListener("PYTORCH_PH_EXTENSION_RESULT", handler);
    window.dispatchEvent(new CustomEvent("PYTORCH_PH_EXTENSION_COMMAND", { detail: { action, requestId, ...payload } }));
  });
}

export function commandError(code: string | undefined, provider?: ExtensionProvider) {
  const name = provider ? providerNames[provider] : "the site";
  const messages: Record<string, string> = {
    login_required: `Sign in to ${name} in this browser first.`,
    identity_mismatch: `This profile is not the ${name} account signed in to this browser.`,
    verification_required: `Complete the ${name} verification or CAPTCHA yourself, then try again.`,
    rate_limited: `${name} is rate limiting this session. Wait before trying again.`,
    unsupported_page: `That is not a supported ${name} profile.`,
    layout_drift: `The ${name} page layout did not match the verified adapter. Collection stopped for review.`,
    page_timeout: `${name} took too long to load. Try again.`,
    collector_unavailable: "The extension could not read the page. Reload the extension and try again.",
    extension_unavailable: "The extension is not responding. Install or reload it, then try again.",
    untrusted_sender: "The extension only accepts requests from the PyTorch PH portal.",
  };
  return new Error(messages[code || ""] || "The extension stopped safely.");
}
