import type { UserTier } from "./access-rules";
import type { PortalAudience } from "./audience-shape";

export type CapabilityState = "available" | "read_only" | "locked";

export type CapabilityKey =
  | "connections"
  | "evidence_read"
  | "evidence_write"
  | "evidence_scrape"
  | "resume_read"
  | "resume_generate"
  | "analytics_read"
  | "analytics_write"
  | "opportunities_read"
  | "job_discovery"
  | "application_draft";

export type Capability = {
  state: CapabilityState;
  reason: string;
  missing: string[];
};

export type CapabilityManifest = {
  developmentOwner: boolean;
  localDemo: boolean;
  authenticatedUser?: boolean;
  portal: {
    audience: PortalAudience;
    role: string;
    isOfficer: boolean;
    canViewDiagnostics: boolean;
    userTier: UserTier;
  };
  capabilities: Record<CapabilityKey, Capability>;
};

type CapabilityInputs = {
  developmentOwner: boolean;
  authenticatedUser?: boolean;
  identityConnected: boolean;
  socialConnected: boolean;
  jobSiteConnected: boolean;
  evidenceReady: boolean;
  normalizedProfileReady: boolean;
  resumeArtifactsReady: boolean;
  aiConfigured: boolean;
  visualDemo?: boolean;
  localDemo?: boolean;
  audience?: PortalAudience;
  role?: string;
  isOfficer?: boolean;
  canViewDiagnostics?: boolean;
  userTier?: UserTier;
};

const locked = (reason: string, missing: string[] = []): Capability => ({ state: "locked", reason, missing });
const available = (reason: string): Capability => ({ state: "available", reason, missing: [] });
const readOnly = (reason: string): Capability => ({ state: "read_only", reason, missing: [] });

export function buildCapabilityManifest(input: CapabilityInputs): CapabilityManifest {
  const privilegedOperator = input.developmentOwner || input.isOfficer === true;
  const canOwnCareerData = input.developmentOwner || input.authenticatedUser === true;
  const ownerRequired = locked("Available only in the authorized local development session.", ["development owner session"]);
  const connections = canOwnCareerData
    ? available("Local connection status is available without exposing credentials or session contents.")
    : ownerRequired;
  const evidenceRead = canOwnCareerData
    ? available(input.evidenceReady
      ? "Career Evidence is open for manual review and editing."
      : "Career Evidence is open for manual entry; automated collection is gated separately.")
    : ownerRequired;
  const evidenceScrape = !input.developmentOwner
    ? ownerRequired
    : !input.aiConfigured
      ? locked("Configure a local or remote AI endpoint in Settings before collecting scraper evidence.", ["AI endpoint and model"])
    : input.identityConnected || input.socialConnected
      ? available("An approved local source session is available for evidence collection.")
      : locked("Connect an approved identity or social source before collecting evidence.", ["approved source session"]);
  const evidenceWrite = canOwnCareerData
    ? available("You may create and approve your own career evidence through the server gateway.")
    : ownerRequired;
  const resumeRead = canOwnCareerData
    ? available(input.resumeArtifactsReady
      ? "Resume Studio is open for manual template review and export."
      : "Resume Studio is open; add or edit Career Evidence to build its manual snapshot.")
    : ownerRequired;
  const resumeGenerate = !input.developmentOwner
    ? ownerRequired
    : !input.aiConfigured
      ? locked("Configure the AI endpoint in Settings before generating a resume.", ["AI endpoint and model"])
    : input.normalizedProfileReady
      ? available("Resume generation may consume the normalized middleman profile.")
      : locked("Run the evidence middleman before generating a resume.", ["middleman-produced user_profile.json"]);
  const jobDiscovery = privilegedOperator && input.aiConfigured && input.jobSiteConnected
    ? available("The verified local job-site browser session is connected.")
    : input.visualDemo
      ? readOnly("Prototype opportunities are viewable; live discovery remains locked until a job-site session is verified.")
      : !privilegedOperator
        ? ownerRequired
        : !input.aiConfigured
          ? locked("Configure the AI endpoint before starting a scraper-connected job pipeline.", ["AI endpoint and model"])
        : locked("Open and verify the approved job-site browser session first.", ["verified job-site session"]);
  const opportunitiesRead = canOwnCareerData
    ? available("Opportunities is open for manual review; automated discovery is gated separately.")
    : ownerRequired;
  const applicationDraft = !privilegedOperator
    ? ownerRequired
    : !input.aiConfigured
      ? locked("Configure the AI endpoint before application planning.", ["AI endpoint and model"])
    : !input.jobSiteConnected
      ? locked("A verified job-site session is required before application drafting.", ["verified job-site session"])
      : !input.resumeArtifactsReady
        ? locked("A real generated resume artifact is required before application drafting.", ["generated resume artifact"])
        : available("Draft-safe automation is available; all existing human gates remain enforced.");

  return {
    developmentOwner: input.developmentOwner,
    localDemo: input.localDemo === true,
    authenticatedUser: input.authenticatedUser,
    portal: {
      audience: input.audience || "member",
      role: input.role || "anonymous",
      isOfficer: input.isOfficer === true,
      canViewDiagnostics: input.canViewDiagnostics === true,
      userTier: input.userTier || "general",
    },
    capabilities: {
      connections,
      evidence_read: evidenceRead,
      evidence_write: evidenceWrite,
      evidence_scrape: evidenceScrape,
      resume_read: resumeRead,
      resume_generate: resumeGenerate,
      analytics_read: readOnly("Analytics may query existing snapshots with local filters."),
      analytics_write: locked("Browser analytics is read-only; refresh and import belong to controlled backend ingestion."),
      opportunities_read: opportunitiesRead,
      job_discovery: jobDiscovery,
      application_draft: applicationDraft,
    },
  };
}

export const lockedCapabilityManifest = () => buildCapabilityManifest({
  developmentOwner: false,
  authenticatedUser: false,
  identityConnected: false,
  socialConnected: false,
  jobSiteConnected: false,
  evidenceReady: false,
  normalizedProfileReady: false,
  resumeArtifactsReady: false,
  aiConfigured: false,
  localDemo: false,
});
