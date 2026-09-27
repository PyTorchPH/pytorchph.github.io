import type { Connection, EvidenceSource } from "@pytorch-ph/domain-protocol/career-evidence";

export const supportedEvidenceSources: EvidenceSource[] = [
  { id: "github", label: "GitHub", kind: "Projects and contributions", status: "ready", maturity: "available", connectionStatus: "disconnected", connectionMethod: "website_session", description: "Website-first project evidence using cached, layout-scoped extraction rules.", permissions: ["Read public projects", "Read contribution metadata"], evidenceCount: 0, lastSyncedAt: null },
  { id: "linkedin", label: "LinkedIn", kind: "Professional profile and posts", status: "ready", maturity: "available", connectionStatus: "disconnected", connectionMethod: "website_session", description: "Uses a user-approved visible browser session and stops when verification is required.", permissions: ["Read visible profile", "Read selected posts"], evidenceCount: 0, lastSyncedAt: null },
  { id: "facebook", label: "Facebook", kind: "Selected public posts", status: "ready", maturity: "available", connectionStatus: "disconnected", connectionMethod: "website_session", description: "Collection pauses at login, CAPTCHA, or account verification.", permissions: ["Read user-selected posts"], evidenceCount: 0, lastSyncedAt: null },
  { id: "twitter", label: "Twitter / X", kind: "Public posts", status: "ready", maturity: "beta", connectionStatus: "disconnected", connectionMethod: "website_session", description: "Beta adapter with bounded DOM sampling and deterministic rule replay.", permissions: ["Read selected public posts"], evidenceCount: 0, lastSyncedAt: null },
  { id: "instagram", label: "Instagram", kind: "Public portfolio posts", status: "ready", maturity: "beta", connectionStatus: "disconnected", connectionMethod: "website_session", description: "Beta adapter; challenged sessions always require human completion.", permissions: ["Read selected public posts"], evidenceCount: 0, lastSyncedAt: null },
  { id: "website", label: "Generic website", kind: "Portfolio or project URL", status: "ready", maturity: "experimental", connectionStatus: "disconnected", connectionMethod: "url", description: "AI plans strict rules from a bounded rendered-DOM inventory, then code replays them.", permissions: ["Read the submitted URL"], evidenceCount: 0, lastSyncedAt: null },
  { id: "upload", label: "Photos & documents", kind: "Private uploads", status: "ready", maturity: "available", connectionStatus: "connected", connectionMethod: "upload", description: "Private evidence selected by the user. AI analysis requires approval every time.", permissions: ["Store selected files privately"], evidenceCount: 0, lastSyncedAt: null },
  { id: "manual", label: "Manual entry", kind: "User-authored evidence", status: "ready", maturity: "available", connectionStatus: "connected", connectionMethod: "manual", description: "The user remains the source of truth and can revise any normalized achievement.", permissions: ["Save user-entered evidence"], evidenceCount: 0, lastSyncedAt: null },
];

export function supportedSourceById(id: string): EvidenceSource | undefined {
  return supportedEvidenceSources.find((source) => source.id === id);
}

export function sourcesWithConnectionState(connections: Connection[], collectedCount = 0): EvidenceSource[] {
  const states = new Map(connections.map((connection) => [connection.id.toLowerCase(), connection.status]));
  return supportedEvidenceSources.map((source) => {
    const status = states.get(source.id) || source.connectionStatus;
    return {
      ...source,
      connectionStatus: status,
      status: status === "verification_required" ? "blocked" : status === "connected" ? "verified" : "ready",
      evidenceCount: source.id === "upload" ? collectedCount : source.evidenceCount,
    };
  });
}
