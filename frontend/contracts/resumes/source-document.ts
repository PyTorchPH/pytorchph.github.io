import { z } from "zod";

import {
  claimEvidenceLinkSchema,
  claimSchema,
  evidenceSchema,
  targetSchema,
} from "./evidence-graph";

const text = z.string().trim().min(1);
const optionalText = text.optional();
const recordKindSchema = z.enum([
  "experience",
  "project",
  "education",
  "skill_group",
  "organization",
  "award",
  "certificate",
  "publication",
  "language",
  "interest",
  "reference",
  "custom",
]);

const linkSchema = z.object({
  label: text,
  url: z.string().url(),
}).strict();

const periodSchema = z.object({
  start: optionalText,
  end: optionalText,
  label: optionalText,
}).strict().superRefine((period, context) => {
  if (!period.start && !period.end && !period.label) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A period needs start, end, or label." });
  }
});

export const resumeSourceRecordSchema = z.object({
  id: text,
  kind: recordKindSchema,
  name: text,
  role: optionalText,
  organization: optionalText,
  issuer: optionalText,
  location: optionalText,
  period: periodSchema.optional(),
  summary: optionalText,
  highlights: z.array(text).default([]),
  skills: z.array(text).default([]),
  skillIds: z.array(text).default([]),
  claimIds: z.array(text).default([]),
  targetIds: z.array(text).default([]),
  links: z.array(linkSchema).default([]),
  details: z.record(z.union([text, z.number().finite(), z.boolean(), z.array(text)])).default({}),
}).strict().superRefine((record, context) => {
  if (record.kind === "experience" && !record.organization) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["organization"], message: "Experience requires an organization." });
  }
  if (record.kind === "education" && !record.organization) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["organization"], message: "Education requires an institution." });
  }
  if (record.kind === "skill_group" && record.skills.length === 0 && record.skillIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["skills"], message: "A skill group requires skills or skillIds." });
  }
});

const resumeSourceDocumentObjectSchema = z.object({
  contract: z.literal("resume-source/v1"),
  document: z.object({
    id: text,
    language: text.default("en"),
    intendedPageCount: z.number().int().positive().optional(),
    title: optionalText,
  }).strict(),
  person: z.object({
    name: z.object({
      display: text,
      given: optionalText,
      middle: optionalText,
      family: optionalText,
    }).strict(),
    contacts: z.array(z.object({
      kind: z.enum(["email", "phone", "location", "website", "other"]),
      label: optionalText,
      value: text,
      url: z.string().url().optional(),
      visibility: z.enum(["resume", "private"]).default("resume"),
    }).strict()).default([]),
    profiles: z.array(z.object({
      network: text,
      username: optionalText,
      url: z.string().url(),
    }).strict()).default([]),
    positioning: z.object({
      headline: text,
      summary: optionalText,
      targetRoleIds: z.array(text).default([]),
    }).strict(),
  }).strict(),
  targets: z.array(targetSchema).default([]),
  records: z.array(resumeSourceRecordSchema).default([]),
  claims: z.array(claimSchema).default([]),
  evidence: z.array(evidenceSchema).default([]),
  claimEvidenceLinks: z.array(claimEvidenceLinkSchema).default([]),
  environments: z.array(z.object({
    id: text,
    deployment: text,
    details: z.record(z.union([text, z.number().finite(), z.boolean()])),
  }).strict()).default([]),
  artifacts: z.array(z.object({
    id: text,
    type: z.enum(["raw_result", "report", "source", "presentation", "certificate"]),
    locator: text,
    contentHash: optionalText,
  }).strict()).default([]),
  skills: z.array(z.object({
    id: text,
    name: text,
    aliases: z.array(text).default([]),
    category: optionalText,
  }).strict()).default([]),
  sources: z.array(z.object({
    id: text,
    kind: z.enum(["pdf", "document", "web", "manual", "scrape", "artifact"]),
    locator: text,
    capturedAt: z.string().datetime().optional(),
    contentHash: optionalText,
  }).strict()).default([]),
  fieldProvenance: z.array(z.object({
    path: text,
    sourceIds: z.array(text).min(1),
    confidence: z.number().min(0).max(1),
    status: z.enum(["extracted", "confirmed", "rejected"]),
    notes: z.array(text).default([]),
  }).strict()).default([]),
  presentationHints: z.object({
    sectionOrder: z.array(recordKindSchema).default([]),
    sectionLabels: z.record(text).default({}),
    sectionLayouts: z.record(z.object({
      mode: z.enum(["stack", "columns", "compact_list"]),
      columns: z.number().int().min(1).max(4).optional(),
    }).strict()).default({}),
    density: z.enum(["comfortable", "compact", "dense"]).default("compact"),
    pageGoal: z.number().int().positive().optional(),
    showProfileLabels: z.boolean().default(true),
  }).strict(),
  generationPolicy: z.object({
    neverInventMissingFacts: z.literal(true),
    quantitativeClaimsRequireEvidence: z.literal(true),
    preserveSourceWording: z.boolean().default(false),
    requireHumanReviewBeforeExport: z.literal(true),
  }).strict(),
  metadata: z.object({
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    schemaBasis: z.array(text).default([]),
  }).strict(),
  extensions: z.record(z.unknown()).default({}),
}).strict();

export const resumeSourceDocumentSchema = resumeSourceDocumentObjectSchema.superRefine((document, context) => {
  validateUniqueIds(document.records, "records", context);
  validateUniqueIds(document.claims, "claims", context);
  validateUniqueIds(document.evidence, "evidence", context);
  validateUniqueIds(document.environments, "environments", context);
  validateUniqueIds(document.artifacts, "artifacts", context);
  validateUniqueIds(document.skills, "skills", context);
  validateUniqueIds(document.sources, "sources", context);
  validateUniqueIds(document.targets, "targets", context);

  const contactKinds = new Set(document.person.contacts.filter((contact) => contact.visibility === "resume").map((contact) => contact.kind));
  (["email", "phone", "location"] as const).forEach((kind) => {
    if (!contactKinds.has(kind)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["person", "contacts"], message: `A resume-visible ${kind} contact is required.` });
  });

  const claimIds = new Set(document.claims.map(({ id }) => id));
  const evidenceIds = new Set(document.evidence.map(({ id }) => id));
  const evidenceById = new Map(document.evidence.map((evidence) => [evidence.id, evidence]));
  const environmentIds = new Set(document.environments.map(({ id }) => id));
  const artifactIds = new Set(document.artifacts.map(({ id }) => id));
  const skillIds = new Set(document.skills.map(({ id }) => id));
  const sourceIds = new Set(document.sources.map(({ id }) => id));
  const targetIds = new Set(document.targets.map(({ id }) => id));

  validateReferences(document.person.positioning.targetRoleIds, targetIds, ["person", "positioning", "targetRoleIds"], "target", context);

  document.records.forEach((record, index) => {
    validateReferences(record.claimIds, claimIds, ["records", index, "claimIds"], "claim", context);
    validateReferences(record.skillIds, skillIds, ["records", index, "skillIds"], "skill", context);
    validateReferences(record.targetIds, targetIds, ["records", index, "targetIds"], "target", context);
  });
  document.claimEvidenceLinks.forEach((link, index) => {
    validateReferences([link.claimId], claimIds, ["claimEvidenceLinks", index, "claimId"], "claim", context);
    validateReferences([link.evidenceId], evidenceIds, ["claimEvidenceLinks", index, "evidenceId"], "evidence", context);
    const linkedEvidence = evidenceById.get(link.evidenceId);
    if (linkedEvidence) {
      validateReferences(
        link.measurementIds,
        new Set(linkedEvidence.measurements.map(({ id }) => id)),
        ["claimEvidenceLinks", index, "measurementIds"],
        "measurement on linked evidence",
        context,
      );
    }
  });
  document.evidence.forEach((evidence, index) => {
    if (evidence.environmentId) validateReferences([evidence.environmentId], environmentIds, ["evidence", index, "environmentId"], "environment", context);
    validateReferences(evidence.artifactIds, artifactIds, ["evidence", index, "artifactIds"], "artifact", context);
  });
  document.fieldProvenance.forEach((provenance, index) => {
    validateReferences(provenance.sourceIds, sourceIds, ["fieldProvenance", index, "sourceIds"], "source", context);
  });
});

export type ResumeSourceDocument = z.infer<typeof resumeSourceDocumentSchema>;
export type ResumeSourceRecord = z.infer<typeof resumeSourceRecordSchema>;
export type ResumeSourceRecordKind = z.infer<typeof recordKindSchema>;

function validateUniqueIds(
  values: Array<{ id: string }>,
  path: string,
  context: z.RefinementCtx,
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: [path, index, "id"], message: `Duplicate id: ${value.id}` });
    seen.add(value.id);
  });
}

function validateReferences(
  references: string[],
  available: Set<string>,
  path: Array<string | number>,
  label: string,
  context: z.RefinementCtx,
) {
  references.forEach((reference) => {
    if (!available.has(reference)) context.addIssue({ code: z.ZodIssueCode.custom, path, message: `Unknown ${label}: ${reference}` });
  });
}
