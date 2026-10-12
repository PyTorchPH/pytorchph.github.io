import { z } from "zod";

const text = z.string().min(1);

export const portfolioEvidenceContractSchema = z.object({
  schema: z.literal("portfolio-evidence/v2"),
  generated_at: z.string().datetime(),
  generator: z.object({
    path: text,
    version: text,
    mode: text,
  }).passthrough(),
  scope: z.record(z.unknown()),
  privacy: z.object({
    credentials_exported: z.literal(false),
  }).passthrough(),
  summary: z.record(z.unknown()),
  projects: z.array(z.object({
    project_name: text,
    source_presence: z.record(z.unknown()),
    test_inventory: z.record(z.unknown()),
    execution_evidence: z.unknown(),
    measured_results: z.unknown(),
    evidence_gaps: z.record(z.unknown()),
  }).passthrough()),
  evidence_updates: z.array(z.unknown()),
}).passthrough();

export type PortfolioEvidenceContract = z.infer<typeof portfolioEvidenceContractSchema>;
