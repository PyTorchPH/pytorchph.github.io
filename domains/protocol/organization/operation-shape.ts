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

export const eventCategorySchema = z.enum(["events", "workshops", "hackathons", "competitive-programming"]);
export type EventCategory = z.infer<typeof eventCategorySchema>;

export const eventPackageSchema = z.object({
  title: z.string().trim().min(3).max(200),
  organizer: z.string().trim().min(2).max(200),
  summary: z.string().trim().min(10).max(3000),
  category: eventCategorySchema,
  scope: z.literal("external"),
  startAt: z.string().min(1).max(100),
  endAt: z.string().max(100).nullable(),
  timezone: z.string().min(1).max(80),
  venue: z.string().min(1).max(300),
  registrationUrl: z.string().url().nullable(),
  registrationDeadline: z.string().max(100).nullable(),
  fee: z.string().max(120),
  eligibility: z.array(z.string().max(300)).max(20),
  requirements: z.array(z.string().max(300)).max(30),
  sourceUrl: z.string().url(),
  scrapedAt: z.string(),
  contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  scraperVersion: z.string().max(80),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string().max(300)).max(20),
}).strict();
export type EventPackage = z.infer<typeof eventPackageSchema>;

export const eventActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("interest") }).strict(),
  z.object({ action: z.literal("approve_department"), department: departmentSchema.optional() }).strict(),
  z.object({ action: z.literal("approve_email") }).strict(),
  z.object({ action: z.literal("confirm_manual_delivery"), detail: z.string().trim().min(4).max(500) }).strict(),
  z.object({ action: z.literal("record_sado_approval"), detail: z.string().trim().min(4).max(500) }).strict(),
]);
export type EventAction = z.infer<typeof eventActionSchema>;

export const requiredDepartmentsByCategory: Record<EventCategory, Department[]> = {
  events: ["secretariat", "treasurer", "external_relations", "executive"],
  workshops: ["secretariat", "external_relations"],
  hackathons: ["secretariat", "treasurer", "external_relations"],
  "competitive-programming": ["secretariat", "treasurer", "academics"],
};

export type EventMailDraft = {
  subject: string;
  body: string;
  revisionHash: string;
  deliveryMode: "copy_export" | "gmail";
  deliveryStatus: "pending" | "exported" | "sending" | "sent" | "failed";
};

export type ExternalEvent = EventPackage & {
  id: string;
  submittedBy: string;
  submitterLabel: string;
  status: "not_sado_approved" | "department_review" | "email_review" | "submitted_to_sado" | "sado_approved" | "rejected";
  interested: boolean;
  interestCount: number;
  revision: number;
  requiredDepartments: Department[];
  approvedDepartments: Department[];
  departmentApprovals: number;
  departmentTotal: number;
  emailDraft: EventMailDraft | null;
  sadoReference: string | null;
  createdAt: string;
};
