import { z } from "zod";

export const departmentSchema = z.enum([
  "secretariat",
  "treasurer",
  "external_relations",
  "academics",
  "executive",
]);
export type Department = z.infer<typeof departmentSchema>;

export const evidenceClaimSchema = z.object({
  id: z.string(),
  memberLabel: z.string(),
  title: z.string(),
  source: z.enum(["facebook", "linkedin", "github", "manual"]),
  provenance: z.enum(["scraped_pending", "scraped_verified", "manual_pending", "officer_reviewed", "rejected", "superseded", "disputed"]),
  department: departmentSchema,
  sourceUrl: z.string().url().nullable(),
  contentHash: z.string(),
  points: z.number().int().nonnegative(),
  origin: z.enum(["extension_scrape", "manual"]).optional(),
  proposedLevel: z.enum(["participation", "contributor", "finalist_lead", "winner_top_award"]).optional(),
  normalizedPayload: z.record(z.string(), z.unknown()).optional(),
  warnings: z.array(z.string()).optional(),
  riskSignals: z.array(z.string()).optional(),
  decisionReason: z.string().nullable().optional(),
  updatedAt: z.string(),
}).strict();
export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;

export const evidenceReviewSchema = z.object({
  decision: z.enum(["approve", "scraper_defect", "reject_unsupported", "confirm_falsification", "confirm_tampering"]),
  level: z.enum(["participation", "contributor", "finalist_lead", "winner_top_award"]).optional(),
  reason: z.string().trim().max(1200).default(""),
}).strict().superRefine((value, context) => {
  if (value.decision === "approve" && !value.level) context.addIssue({ code: "custom", path: ["level"], message: "Approval requires a verified level." });
  if (value.decision !== "approve" && value.reason.length < 4) context.addIssue({ code: "custom", path: ["reason"], message: "A review reason is required." });
});
export type EvidenceReview = z.infer<typeof evidenceReviewSchema>;

export const evidenceAppealSchema = z.object({ note: z.string().trim().min(10).max(1200) }).strict();
export const evidenceAppealDecisionSchema = z.object({ decision: z.enum(["restore", "uphold"]), reason: z.string().trim().min(4).max(1200) }).strict();
export const evidenceAppealRequestSchema = evidenceAppealSchema.extend({ sanctionId: z.string().uuid() }).strict();
export type EvidenceIntegrityCase = { sanctionId: string; claimId: string; reason: string; imposedAt: string; appeal: null | { id: string; state: "open" | "restored" | "upheld"; note: string; decisionReason: string | null; createdAt: string; decidedAt: string | null } };
export type OfficerEvidenceAppeal = NonNullable<EvidenceIntegrityCase["appeal"]> & { sanctionId: string; claimId: string; memberLabel: string; violationType: "manual_falsification" | "scraper_tampering" };
