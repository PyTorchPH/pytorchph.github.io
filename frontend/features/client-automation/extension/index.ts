// The PyTorch PH browser extension, seen from the portal.
// Module map:
//   status                  presence, version, capabilities, operational events
//   bridge                  command transport and readable command errors
//   use-evidence-extension  React hook for extension presence
//   collect                 active-tab and own-profile evidence collection
//   identity                signed-in account verification
//   capture                 bug-report screenshots
//   local-ai                the member's own AI provider, stored in the extension
//   capability-overlay      install notice over features that need the extension
export { extensionSupports, type ExtensionStatus } from "./status";
export { type ExtensionProvider } from "./bridge";
export { useEvidenceExtension } from "./use-evidence-extension";
export { collectEvidenceFromExtension, collectOwnProfile, type CollectedPayload } from "./collect";
export { verifyIdentity, type VerifiedIdentity } from "./identity";
export { captureVisibleTab } from "./capture";
export { aiClear, aiComplete, aiConfigure, aiStatus, type LocalAIConfig, type LocalAIStatus } from "./local-ai";
export { ExtensionCapabilityOverlay } from "./capability-overlay";
