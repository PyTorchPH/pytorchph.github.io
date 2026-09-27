import { z } from "zod";

export const evidenceSourceSchema = z.enum(["facebook", "linkedin", "github", "manual"]);
export const evidenceOriginSchema = z.enum(["extension_scrape", "manual"]);
export const evidenceLevelSchema = z.enum(["participation", "contributor", "finalist_lead", "winner_top_award"]);

export const evidenceSubmissionItemSchema = z.object({
  title: z.string().trim().min(3).max(240),
  text: z.string().trim().min(1).max(5_000),
  sourceUrl: z.string().url(),
  postedAt: z.string().datetime().nullable(),
  mediaUrls: z.array(z.string().url()).max(10).default([]),
  evidenceKind: z.enum(["achievement", "project", "competition", "activity"]).default("achievement"),
  department: z.enum(["secretariat", "treasurer", "external_relations", "academics", "executive"]).default("academics"),
  proposedLevel: evidenceLevelSchema,
}).strict();

export const evidenceSubmissionEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  source: evidenceSourceSchema,
  origin: evidenceOriginSchema,
  collectedAt: z.string().datetime(),
  adapterVersion: z.string().regex(/^[A-Za-z0-9._-]{3,80}$/),
  layoutFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  pageUrl: z.string().url(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  items: z.array(evidenceSubmissionItemSchema).min(1).max(50),
  warnings: z.array(z.string().max(300)).max(20).default([]),
}).strict().superRefine((value, context) => {
  if (value.origin === "extension_scrape" && value.source === "manual") context.addIssue({ code: "custom", path: ["source"], message: "Extension evidence requires a website source." });
  const host = new URL(value.pageUrl).hostname;
  const expected = value.source === "facebook" ? /(^|\.)facebook\.com$/ : value.source === "linkedin" ? /(^|\.)linkedin\.com$/ : value.source === "github" ? /^github\.com$/ : null;
  if (expected && !expected.test(host)) context.addIssue({ code: "custom", path: ["pageUrl"], message: "Page URL does not match the evidence source." });
  value.items.forEach((item, index) => {
    if (expected && !expected.test(new URL(item.sourceUrl).hostname)) context.addIssue({ code: "custom", path: ["items", index, "sourceUrl"], message: "Evidence URL does not match the evidence source." });
  });
});

export type EvidenceSubmissionEnvelope = z.infer<typeof evidenceSubmissionEnvelopeSchema>;
