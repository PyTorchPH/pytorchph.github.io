import { z } from "zod";

const text = z.string().trim().min(1);
const stringList = z.array(text).default([]);

export const resumeSectionSchema = z.enum([
  "summary", "skills", "experience", "projects", "education",
  "certifications", "awards", "publications", "volunteer",
]);
export const evidenceMaturitySchema = z.enum([
  "unsupported", "documented", "measured", "controlled_measured", "replicated",
]);
export const evidenceStatusSchema = z.enum(["unverified", "user_verified", "officer_verified"]);
export const rubricLevelSchema = z.enum([
  "participation", "contributor", "finalist_lead", "winner_top_award",
]);

export const measuredMetricSchema = z.object({
  name: text,
  value: z.number().finite(),
  unit: text,
  scope: text,
}).strict();

export const resumeClaimSchema = z.object({
  id: text,
  claimType: z.enum(["qualitative", "quantitative"]),
  canonicalText: text,
  qualityClassifications: z.array(z.object({
    framework: z.enum(["ISO/IEC 25010:2023", "ISO/IEC 25023:2016", "local"]),
    characteristic: text,
  }).strict()).min(1),
  evidence: z.object({
    maturity: evidenceMaturitySchema,
    status: evidenceStatusSchema,
    resumeEligible: z.boolean(),
    method: text,
    metrics: z.array(measuredMetricSchema),
    artifacts: z.array(z.object({
      kind: z.enum(["report", "raw_result", "source", "presentation", "certificate"]),
      locator: text,
      contentHash: z.string().optional(),
    }).strict()),
    verification: z.object({ verifier: text, verifiedAt: z.string().datetime().optional() }).strict(),
    limitations: stringList,
  }).strict(),
  output: z.object({
    include: z.boolean(),
    renderedText: text,
    destinations: z.array(text).min(1),
    targetIds: z.array(text).min(1),
    atsKeywords: stringList,
  }).strict(),
}).strict().superRefine((claim, context) => {
  if (claim.claimType === "quantitative" && claim.evidence.metrics.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence", "metrics"], message: "Quantitative claims require numeric metrics." });
  }
  if (claim.evidence.resumeEligible && (
    claim.evidence.status === "unverified"
    || !["controlled_measured", "replicated"].includes(claim.evidence.maturity)
    || claim.evidence.metrics.length === 0
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence", "resumeEligible"], message: "Resume-eligible evidence must be verified, controlled-measured, and numeric." });
  }
});

export const resumeEntrySchema = z.object({
  id: text,
  section: resumeSectionSchema,
  title: text,
  organization: z.string(),
  dateLabel: z.string(),
  summary: z.string(),
  skills: stringList,
  claims: z.array(resumeClaimSchema),
}).strict();

export const evidenceBackedResumeSchema = z.object({
  $schema: z.string().optional(),
  contract: z.literal("evidence-backed-resume/v1"),
  documentId: text,
  subject: z.object({
    name: text, label: text, email: z.string().email(), location: text,
    phone: z.string().optional(), url: z.string().url().optional(),
  }).strict(),
  targets: z.array(z.object({ id: text, role: text, keywords: stringList }).strict()).min(1),
  sectionOrder: z.array(resumeSectionSchema).min(1),
  entries: z.array(resumeEntrySchema),
  generationPolicy: z.object({
    quantitativeClaimsRequireEligibleEvidence: z.literal(true),
    preserveLimitations: z.literal(true),
    requireHumanReviewBeforeExport: z.literal(true),
  }).strict(),
  metadata: z.object({ createdAt: z.string().datetime(), updatedAt: z.string().datetime(), sources: stringList }).strict(),
  extensions: z.record(z.unknown()).default({}),
}).strict().superRefine((document, context) => {
  const targetIds = new Set(document.targets.map((target) => target.id));
  const ids = new Set<string>();
  for (const entry of document.entries) {
    if (ids.has(entry.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries"], message: `Duplicate ID: ${entry.id}` });
    ids.add(entry.id);
    for (const claim of entry.claims) {
      if (ids.has(claim.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries"], message: `Duplicate ID: ${claim.id}` });
      ids.add(claim.id);
      for (const targetId of claim.output.targetIds) {
        if (!targetIds.has(targetId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries"], message: `Unknown target ID: ${targetId}` });
      }
    }
  }
});

export type EvidenceBackedResume = z.infer<typeof evidenceBackedResumeSchema>;
export type ResumeClaim = z.infer<typeof resumeClaimSchema>;
export type RubricLevel = z.infer<typeof rubricLevelSchema>;

export type EvidenceAssessment = {
  grade: "unsupported" | "documented" | "measured" | "verified";
  resumeEligible: boolean;
  pointEligible: boolean;
  reasons: string[];
};

export function assessClaimEvidence(claim: ResumeClaim): EvidenceAssessment {
  const hasArtifacts = claim.evidence.artifacts.length > 0;
  const hasMetrics = claim.evidence.metrics.length > 0;
  const verified = claim.evidence.status === "officer_verified";
  const grade = verified && hasMetrics ? "verified" : hasMetrics ? "measured" : hasArtifacts ? "documented" : "unsupported";
  const reasons = [
    ...(!hasArtifacts ? ["missing_artifact"] : []),
    ...(!hasMetrics ? ["missing_numeric_metric"] : []),
    ...(!verified ? ["officer_verification_required_for_points"] : []),
  ];
  return {
    grade,
    resumeEligible: claim.evidence.resumeEligible && hasMetrics && claim.evidence.status !== "unverified",
    pointEligible: verified && hasArtifacts && hasMetrics,
    reasons,
  };
}

const rubricUnits: Record<RubricLevel, number> = {
  participation: 1, contributor: 2, finalist_lead: 3, winner_top_award: 4,
};

export function previewOfficerSelectedPoints(
  claim: ResumeClaim,
  officerSelectedLevel: RubricLevel | undefined,
  source: string,
): number | null {
  if (!officerSelectedLevel || !assessClaimEvidence(claim).pointEligible) return null;
  const sourceWeight = source === "github" ? 2 : 3;
  return rubricUnits[officerSelectedLevel] * 10 * sourceWeight;
}
