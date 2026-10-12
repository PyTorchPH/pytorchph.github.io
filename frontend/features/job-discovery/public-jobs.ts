import type { JobMarketSummary } from "@pytorch-ph/domain-protocol/job-discovery";

const REMOTIVE_API = "https://remotive.com/api/remote-jobs";

export type PublicJob = {
  id: number;
  title: string;
  company_name: string;
  candidate_required_location: string;
  url: string;
  publication_date: string;
  salary?: string;
  tags?: string[];
  category?: string;
  job_type?: string;
  description?: string;
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

export function jobSkills(job: PublicJob) {
  return [...new Set([...(job.tags ?? []), job.category].filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

export function skillMatchedJobs(jobs: PublicJob[], memberSkills: string[]) {
  const wanted = memberSkills.map(normalize).filter(Boolean);
  if (!wanted.length) return [];
  return jobs.map((job) => {
    const searchable = normalize([job.title, job.category, ...(job.tags ?? []), stripHtml(job.description ?? "")].join(" "));
    const matchedSkills = memberSkills.filter((_, index) => searchable.includes(wanted[index]));
    return { job, matchedSkills };
  }).filter(({ matchedSkills }) => matchedSkills.length).sort((a, b) => b.matchedSkills.length - a.matchedSkills.length || b.job.publication_date.localeCompare(a.job.publication_date));
}

export function summarizePublicJobs(jobs: PublicJob[], countries: string[], role: string, memberSkills: string[] = []): JobMarketSummary {
  const relevant = memberSkills.length ? skillMatchedJobs(jobs, memberSkills).map(({ job }) => job) : jobs;
  const selected = relevant.filter((job) => !countries.length || countries.some((country) =>
    job.candidate_required_location.toLowerCase().includes(country.toLowerCase())
    || /worldwide|anywhere|global/i.test(job.candidate_required_location)));
  const locations = new Map<string, number>();
  for (const job of selected) locations.set(job.candidate_required_location, (locations.get(job.candidate_required_location) ?? 0) + 1);
  return {
    query: { countries, role_family: role, work_mode: "remote", days: 30 },
    generated_at: new Date().toISOString(), snapshot_kind: "live", sample_size: selected.length,
    unknown_degree_count: selected.length, unknown_experience_count: selected.length,
    sources: [{ id: "remotive", label: "Remotive", kind: "live_api", configured: true, geography: "Remote jobs; listed candidate locations", freshness: "Live browser request", attribution_url: "" }],
    hiring_layoff_series: [{ period: "Current API sample", geography: countries.join(", ") || "Worldwide", active_postings: selected.length, layoffs: null }],
    skill_demand: skillDemand(selected, memberSkills), qualification_barriers: [],
    geography_ratios: [...locations].map(([country, count]) => ({ country, mode: "remote", count, percent: selected.length ? Math.round(count / selected.length * 100) : 0 })),
    personal_comparison: skillDemand(selected, memberSkills), salary_bands: salaryBands(selected), funnel: [],
    warnings: ["Remotive covers remote roles only; it is not a complete labor-market sample.", "Skills use listing tags and current verified member evidence; salary remains unknown when a listing omits it.", "Source: Remotive. Listings may appear with a delay of up to 24 hours."],
  };
}

function skillDemand(jobs: PublicJob[], memberSkills: string[]) {
  const counts = new Map<string, number>();
  for (const job of jobs) for (const skill of jobSkills(job)) counts.set(skill, (counts.get(skill) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([skill, postings]) => ({ skill, postings, evidenced: memberSkills.some((item) => normalize(item) === normalize(skill)) }));
}

function salaryBands(jobs: PublicJob[]) {
  const counts = new Map<string, number>();
  for (const job of jobs) { const band = job.salary?.trim() || "Unknown"; counts.set(band, (counts.get(band) ?? 0) + 1); }
  return [...counts].map(([band, count]) => ({ band, count }));
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
const stripHtml = (value: string) => value.replace(/<[^>]*>/g, " ");
