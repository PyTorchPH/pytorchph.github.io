import type { JobMarketSummary } from "@pytorch-ph/domain-protocol/job-discovery";

const REMOTIVE_API = "https://remotive.com/api/remote-jobs";
export const REMOTIVE_SOURCE = "https://remotive.com/remote-jobs";

export type PublicJob = {
  id: number;
  title: string;
  company_name: string;
  candidate_required_location: string;
  url: string;
  publication_date: string;
  salary?: string;
  tags?: string[];
};

export async function fetchPublicJobs(role: string, signal?: AbortSignal): Promise<PublicJob[]> {
  const url = new URL(REMOTIVE_API);
  if (role.trim()) url.searchParams.set("search", role.trim());
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`Remotive is unavailable (${response.status}).`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("jobs" in body) || !Array.isArray(body.jobs)) throw new Error("Remotive returned an invalid job list.");
  return body.jobs.filter(isPublicJob).slice(0, 100);
}

function isPublicJob(value: unknown): value is PublicJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<PublicJob>;
  return typeof job.id === "number" && Number.isInteger(job.id) && typeof job.title === "string" && typeof job.company_name === "string"
    && typeof job.candidate_required_location === "string" && typeof job.url === "string"
    && job.url.startsWith("https://remotive.com/") && typeof job.publication_date === "string";
}

export function summarizePublicJobs(jobs: PublicJob[], countries: string[], role: string): JobMarketSummary {
  const selected = jobs.filter((job) => !countries.length || countries.some((country) =>
    job.candidate_required_location.toLowerCase().includes(country.toLowerCase())
    || /worldwide|anywhere|global/i.test(job.candidate_required_location)));
  const locations = new Map<string, number>();
  for (const job of selected) locations.set(job.candidate_required_location, (locations.get(job.candidate_required_location) ?? 0) + 1);
  return {
    query: { countries, role_family: role, work_mode: "remote", days: 30 },
    generated_at: new Date().toISOString(), snapshot_kind: "live", sample_size: selected.length,
    unknown_degree_count: selected.length, unknown_experience_count: selected.length,
    sources: [{ id: "remotive", label: "Remotive", kind: "live_api", configured: true, geography: "Remote jobs; listed candidate locations", freshness: "Live browser request", attribution_url: REMOTIVE_SOURCE }],
    hiring_layoff_series: [{ period: "Current API sample", geography: countries.join(", ") || "Worldwide", active_postings: selected.length, layoffs: null }],
    skill_demand: [], qualification_barriers: [],
    geography_ratios: [...locations].map(([country, count]) => ({ country, mode: "remote", count, percent: selected.length ? Math.round(count / selected.length * 100) : 0 })),
    personal_comparison: [], salary_bands: [], funnel: [],
    warnings: ["Remotive covers remote roles only; it is not a complete labor-market sample.", "Degree, experience, skills, and evidence fit remain unknown until validated extraction and scoring are available.", "Source: Remotive. Listings may appear with a delay of up to 24 hours."],
  };
}
