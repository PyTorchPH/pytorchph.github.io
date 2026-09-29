import { z } from "zod";

export type WorkMode = "remote" | "hybrid" | "onsite" | "any" | "unknown";

export type SourceStatus = {
  id: string;
  label: string;
  kind: "live_api" | "annual_dataset" | "official_series" | "import";
  configured: boolean;
  geography: string;
  freshness: string;
  attribution_url: string;
  note?: string;
};

export type JobMarketSummary = {
  query: { countries: string[]; role_family: string; work_mode: WorkMode; days: number };
  generated_at: string;
  snapshot_kind: "live" | "cached" | "synthetic_demo";
  sample_size: number;
  unknown_degree_count: number;
  unknown_experience_count: number;
  sources: SourceStatus[];
  hiring_layoff_series: Array<Record<string, string | number | null>>;
  skill_demand: Array<{ skill: string; postings: number; evidenced: boolean }>;
  qualification_barriers: Array<{ label: string; count: number; percent: number }>;
  geography_ratios: Array<{ country: string; mode: string; count: number; percent: number }>;
  personal_comparison: Array<{ skill: string; postings: number; evidenced: boolean }>;
  salary_bands: Array<Record<string, string | number>>;
  funnel: Array<Record<string, string | number | null>>;
  warnings: string[];
};

export const jobMarketFilterSchema = z.object({
  country: z.string().trim().min(2).max(80),
  compareCountry: z.string().trim().max(80),
  role: z.string().trim().min(2).max(80),
  mode: z.enum(["any", "remote", "hybrid", "onsite"]),
});

export type JobMarketFilters = z.infer<typeof jobMarketFilterSchema>;
