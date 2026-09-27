import type { EvidenceItem } from "./view-shape";

function text(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function strings(value: unknown, limit = 25) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 500)).filter(Boolean).slice(0, limit) : [];
}

export function validatedEvidenceItem(value: unknown, options: { id?: string; approve?: boolean } = {}): EvidenceItem {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const title = text(item.title, 200);
  if (!title) throw new Error("Achievement title is required.");
  const sourceId = text(item.sourceId, 80, "manual");
  const collectionOrigin = sourceId === "manual" ? "manual" as const : sourceId === "upload" ? "upload" as const : "automated_scrape" as const;
  const sourceUrl = text(item.sourceUrl, 2_000);
  if (sourceUrl) {
    const parsed = new URL(sourceUrl);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("Source URL must use http or https.");
  }
  const state = text(item.verificationState, 40, "draft");
  const allowedStates = new Set<EvidenceItem["verificationState"]>(["draft", "ai_proposed", "source_matched", "user_verified"]);
  const verificationState = options.approve ? "user_verified" : allowedStates.has(state as EvidenceItem["verificationState"]) ? state as EvidenceItem["verificationState"] : "draft";
  const mediaUrl = text(item.mediaUrl, 4_000, "/demo/evidence/manual-placeholder.svg");
  if (!(mediaUrl.startsWith("/") || mediaUrl.startsWith("https://"))) throw new Error("Evidence media URL is invalid.");
  const confidence = typeof item.confidence === "number" && Number.isFinite(item.confidence) ? Math.max(0, Math.min(100, Math.round(item.confidence))) : undefined;
  const evidenceKind = item.evidenceKind === "experience" ? "experience" as const : "project" as const;
  return {
    id: options.id || text(item.id, 100),
    sourceId,
    evidenceKind,
    collectionOrigin,
    title,
    organization: text(item.organization, 200),
    role: evidenceKind === "experience" ? text(item.role, 200) : "",
    dateLabel: text(item.dateLabel, 100),
    description: text(item.description, 5_000),
    quantitative: strings(item.quantitative),
    qualitative: strings(item.qualitative),
    skills: strings(item.skills, 50).map((skill) => skill.slice(0, 100)),
    mediaUrl,
    mediaAlt: text(item.mediaAlt, 500, `Evidence for ${title}`),
    verificationState,
    confidence,
    sourceUrl: sourceUrl || undefined,
    ...(item.aiProposal && typeof item.aiProposal === "object" ? { aiProposal: item.aiProposal as EvidenceItem["aiProposal"] } : {}),
  };
}
