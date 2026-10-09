import { z } from "zod";

const text = z.string().trim().min(1);
const optionalText = z.string().trim().optional();
const requiredProfileFieldSchema = z.enum([
  "profile.fullName",
  "profile.email",
  "profile.phone",
  "profile.location",
]);

export const qualityClassificationCodeSchema = z.enum([
  "iso25010.functional_suitability",
  "iso25010.performance_efficiency",
  "iso25010.compatibility",
  "iso25010.interaction_capability",
  "iso25010.reliability",
  "iso25010.security",
  "iso25010.maintainability",
  "iso25010.flexibility",
  "iso25010.safety",
]);

export const quantitativeTestTypeSchema = z.enum([
  "unit",
  "integration",
  "end_to_end",
  "load",
  "stress",
  "soak",
  "benchmark",
  "reliability",
  "recovery",
  "security",
  "accessibility",
  "compatibility",
]);

const profileSchema = z.object({
  fullName: text.nullable(),
  email: z.string().email().nullable(),
  phone: text.nullable(),
  location: text.nullable(),
  personalWebsite: z.string().url().optional(),
  linkedIn: z.string().url().optional(),
  github: z.string().url().optional(),
}).strict();

const targetSchema = z.object({
  id: text,
  role: text,
  keywords: z.array(text).default([]),
  preferredClassificationCodes: z.array(qualityClassificationCodeSchema).default([]),
  preferredTestTypes: z.array(quantitativeTestTypeSchema).default([]),
}).strict();

const entrySchema = z.object({
  id: text,
  section: z.enum(["projects", "experience", "education", "skills"]),
  title: optionalText,
  organization: optionalText,
  dateLabel: optionalText,
  summary: optionalText,
  skills: z.array(text).default([]),
  targetIds: z.array(text).default([]),
  claimIds: z.array(text).default([]),
}).strict().superRefine((entry, context) => {
  const requireField = (field: "title" | "organization" | "dateLabel" | "summary") => {
    if (!entry[field]) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required when ${entry.section} is present.` });
  };
  if (entry.section === "projects") {
    requireField("title");
    requireField("summary");
  }
  if (entry.section === "experience") {
    requireField("title");
    requireField("organization");
    requireField("dateLabel");
    requireField("summary");
  }
  if (entry.section === "education") {
    requireField("title");
    requireField("organization");
    requireField("dateLabel");
  }
  if (entry.section === "skills" && entry.skills.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["skills"], message: "At least one skill is required when a skills group is present." });
  }
});

const claimSchema = z.object({
  id: text,
  statement: text,
  classificationCodes: z.array(qualityClassificationCodeSchema).min(1),
}).strict();

const measurementSchema = z.object({
  id: text,
  metric: text,
  value: z.number().finite(),
  unit: text,
  aggregation: text,
  scope: text,
}).strict();

const evidenceSchema = z.object({
  id: text,
  testType: quantitativeTestTypeSchema,
  target: text,
  component: optionalText,
  method: text,
  environmentId: text.optional(),
  workload: z.record(z.union([z.string(), z.number(), z.boolean()])),
  measurements: z.array(measurementSchema).min(1),
  artifactIds: z.array(text).min(1),
  verification: z.object({
    status: z.enum(["unverified", "user_verified", "officer_verified"]),
    verifiedBy: text,
    verifiedAt: z.string().datetime().optional(),
  }).strict(),
  limitations: z.array(text).min(1),
}).strict();

const claimEvidenceLinkSchema = z.object({
  claimId: text,
  evidenceId: text,
  measurementIds: z.array(text).min(1),
  relationship: z.enum(["supports", "contradicts", "context"]),
}).strict();

const narrativeSchema = z.object({
  id: text,
  targetId: text,
  section: z.literal("summary"),
  text,
  sourceClaimIds: z.array(text).default([]),
}).strict();

const resumeEvidenceDraftObjectSchema = z.object({
  contract: z.literal("evidence-backed-resume/v2"),
  documentId: text,
  profile: profileSchema,
  missingRequiredFields: z.array(requiredProfileFieldSchema).default([]),
  targets: z.array(targetSchema).min(1),
  taxonomy: z.object({
    version: z.literal("software-quality-taxonomy/v1"),
    references: z.array(z.object({
      id: z.enum(["iso25010", "iso25023"]),
      standard: text,
      edition: text,
      relationship: z.enum(["classification", "measurement_guidance"]),
    }).strict()).min(1),
  }).strict(),
  entries: z.array(entrySchema).default([]),
  claims: z.array(claimSchema).default([]),
  evidence: z.array(evidenceSchema).default([]),
  claimEvidenceLinks: z.array(claimEvidenceLinkSchema).default([]),
  narratives: z.array(narrativeSchema).default([]),
  environments: z.array(z.object({
    id: text,
    deployment: text,
    details: z.record(z.union([z.string(), z.number(), z.boolean()])),
  }).strict()).default([]),
  artifacts: z.array(z.object({
    id: text,
    type: z.enum(["raw_result", "report", "source", "presentation", "certificate"]),
    locator: text,
    contentHash: z.string().optional(),
  }).strict()).default([]),
  generationPolicy: z.object({
    quantitativeClaimsRequireEvidence: z.literal(true),
    preserveLimitations: z.literal(true),
    requireHumanReviewBeforeExport: z.literal(true),
  }).strict(),
  metadata: z.object({
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    sources: z.array(text).default([]),
  }).strict(),
  extensions: z.record(z.unknown()).default({}),
}).strict();

export const resumeEvidenceDraftSchema = resumeEvidenceDraftObjectSchema.superRefine(validateEvidenceGraph);

export type ResumeEvidenceDraft = z.infer<typeof resumeEvidenceDraftSchema>;
export type RenderableEvidenceResume = Omit<ResumeEvidenceDraft, "profile" | "missingRequiredFields"> & {
  profile: {
    fullName: string;
    email: string;
    phone: string;
    location: string;
    personalWebsite?: string;
    linkedIn?: string;
    github?: string;
  };
  missingRequiredFields: [];
};

export function requiredProfileGaps(draft: ResumeEvidenceDraft) {
  return [
    ["profile.fullName", draft.profile.fullName],
    ["profile.email", draft.profile.email],
    ["profile.phone", draft.profile.phone],
    ["profile.location", draft.profile.location],
  ].filter(([, value]) => !value).map(([field]) => field as z.infer<typeof requiredProfileFieldSchema>);
}

export function promoteResumeDraft(input: unknown): RenderableEvidenceResume {
  const draft = resumeEvidenceDraftSchema.parse(input);
  const gaps = requiredProfileGaps(draft);
  if (gaps.length > 0) throw new Error(`Missing required resume fields: ${gaps.join(", ")}`);
  return {
    ...draft,
    profile: {
      ...draft.profile,
      fullName: draft.profile.fullName!,
      email: draft.profile.email!,
      phone: draft.profile.phone!,
      location: draft.profile.location!,
    },
    missingRequiredFields: [],
  };
}

function validateEvidenceGraph(
  document: z.infer<typeof resumeEvidenceDraftObjectSchema>,
  context: z.RefinementCtx,
) {
  const targetIds = new Set(document.targets.map((target: { id: string }) => target.id));
  const claims = new Map(document.claims.map((claim: { id: string }) => [claim.id, claim]));
  const evidence = new Map(document.evidence.map((item: { id: string }) => [item.id, item]));
  const environments = new Set(document.environments.map((item: { id: string }) => item.id));
  const artifacts = new Set(document.artifacts.map((item: { id: string }) => item.id));
  const linkedClaims = new Set<string>();

  document.entries.forEach((entry: { targetIds: string[]; claimIds: string[] }, index: number) => {
    entry.targetIds.forEach((id) => addReferenceIssue(targetIds.has(id), context, ["entries", index, "targetIds"], `Unknown target ID: ${id}`));
    entry.claimIds.forEach((id) => addReferenceIssue(claims.has(id), context, ["entries", index, "claimIds"], `Unknown claim ID: ${id}`));
  });
  document.narratives.forEach((narrative: { targetId: string; sourceClaimIds: string[] }, index: number) => {
    addReferenceIssue(targetIds.has(narrative.targetId), context, ["narratives", index, "targetId"], `Unknown target ID: ${narrative.targetId}`);
    narrative.sourceClaimIds.forEach((id) => addReferenceIssue(claims.has(id), context, ["narratives", index, "sourceClaimIds"], `Unknown claim ID: ${id}`));
  });
  document.evidence.forEach((item: { environmentId?: string; artifactIds: string[] }, index: number) => {
    if (item.environmentId) addReferenceIssue(environments.has(item.environmentId), context, ["evidence", index, "environmentId"], `Unknown environment ID: ${item.environmentId}`);
    item.artifactIds.forEach((id) => addReferenceIssue(artifacts.has(id), context, ["evidence", index, "artifactIds"], `Unknown artifact ID: ${id}`));
  });
  document.claimEvidenceLinks.forEach((link: { claimId: string; evidenceId: string; measurementIds: string[]; relationship: string }, index: number) => {
    addReferenceIssue(claims.has(link.claimId), context, ["claimEvidenceLinks", index, "claimId"], `Unknown claim ID: ${link.claimId}`);
    const evidenceRecord = evidence.get(link.evidenceId) as { measurements: Array<{ id: string }> } | undefined;
    addReferenceIssue(Boolean(evidenceRecord), context, ["claimEvidenceLinks", index, "evidenceId"], `Unknown evidence ID: ${link.evidenceId}`);
    const measurementIds = new Set(evidenceRecord?.measurements.map((metric) => metric.id) || []);
    link.measurementIds.forEach((id) => addReferenceIssue(measurementIds.has(id), context, ["claimEvidenceLinks", index, "measurementIds"], `Unknown measurement ID: ${id}`));
    if (link.relationship === "supports") linkedClaims.add(link.claimId);
  });
  document.claims.forEach((claim: { id: string }, index: number) => {
    addReferenceIssue(linkedClaims.has(claim.id), context, ["claims", index], `Quantitative claim has no supporting evidence: ${claim.id}`);
  });
}

function addReferenceIssue(valid: boolean, context: z.RefinementCtx, path: Array<string | number>, message: string) {
  if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}
