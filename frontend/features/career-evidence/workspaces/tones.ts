// Small derived labels and tones shared by the career workspaces.
// Module map:
//   sourceTone            badge tone for a source's connection state
//   verificationTone      badge tone for an evidence item's verification state
//   connectionTone        badge tone for a provider connection summary
//   isAutomaticSource     sources AI can read (a signed-in website session or a public URL)
//   sourceAccessLabel     how a source is reached, in words
//   collectionOriginLabel how an evidence item entered the gallery
//   parseSkills           comma-separated skills text as a clean list
//   plural                "s" unless there is exactly one

import type { Connection, EvidenceItem, EvidenceSource } from "@pytorch-ph/domain-protocol/career-evidence";

export const sourceTone = (source: EvidenceSource) =>
  source.connectionStatus === "connected"
    ? "success"
    : source.connectionStatus === "verification_required"
      ? "warning"
      : "default";

export const verificationTone = (state: EvidenceItem["verificationState"]) =>
  state === "user_verified"
    ? "success"
    : state === "ai_proposed"
      ? "orange"
      : "default";

export const connectionTone = (status: Connection["status"]) =>
  status === "connected"
    ? "success"
    : status === "verification_required"
      ? "warning"
      : "default";

// Sources AI can read: a signed-in website session or a public URL. Uploads and manual entry are manual.
export const isAutomaticSource = (source: EvidenceSource) =>
  source.connectionMethod === "website_session" || source.connectionMethod === "url";

export const sourceAccessLabel = (source: EvidenceSource) =>
  source.connectionMethod === "website_session"
    ? "Visible browser session"
    : source.connectionMethod === "url"
      ? "Submitted URL"
      : source.connectionMethod === "upload"
        ? "Private upload"
        : "Manual entry";

export const collectionOriginLabel = (item: EvidenceItem) =>
  (item.collectionOrigin || (item.sourceId === "manual" ? "manual" : item.sourceId === "upload" ? "upload" : "automated_scrape")).replaceAll("_", " ");

export const parseSkills = (skillsText: string) =>
  skillsText
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

export const plural = (count: number) => (count === 1 ? "" : "s");
