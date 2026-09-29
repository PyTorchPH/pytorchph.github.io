import { z } from "zod";

export const manualOpportunitySchema = z.object({
  id: z.string().uuid().optional(),
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).default(""),
  workMode: z.enum(["remote", "hybrid", "onsite", "any", "unknown"]),
  stage: z.enum(["discovered", "saved", "drafted", "human_review", "applied", "rejected", "withdrawn", "confirmed"]),
  fit: z.number().int().min(0).max(100).nullable().default(null),
}).strict();

export type ManualOpportunityInput = z.infer<typeof manualOpportunitySchema>;
