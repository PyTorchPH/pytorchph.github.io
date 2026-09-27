import type { JobMarketSummary } from "@pytorch-ph/domain-protocol/job-discovery";

export const fallbackMarketSummary: JobMarketSummary = {
  query: { countries: ["Philippines"], role_family: "software", work_mode: "any", days: 90 },
  generated_at: "2026-08-13T00:00:00Z",
  snapshot_kind: "synthetic_demo",
  sample_size: 24,
  unknown_degree_count: 7,
  unknown_experience_count: 5,
  sources: [
    { id: "adzuna", label: "Adzuna", kind: "live_api", configured: false, geography: "Supported countries", freshness: "Requires API credentials", attribution_url: "https://developer.adzuna.com/overview" },
    { id: "remotive", label: "Remotive", kind: "live_api", configured: true, geography: "Global remote", freshness: "Public feed delayed by 24 hours", attribution_url: "https://remotive.com/remote-jobs/api" },
    { id: "stackoverflow", label: "Stack Overflow Survey", kind: "annual_dataset", configured: false, geography: "Global respondents", freshness: "Annual import", attribution_url: "https://survey.stackoverflow.co/" },
    { id: "onet", label: "O*NET", kind: "official_series", configured: false, geography: "United States occupations", freshness: "Versioned taxonomy", attribution_url: "https://services.onetcenter.org/" },
    { id: "bls", label: "BLS / JOLTS", kind: "official_series", configured: false, geography: "United States", freshness: "Monthly series", attribution_url: "https://www.bls.gov/developers/home.htm" }
  ],
  hiring_layoff_series: [{ period: "Jun 2026", active_postings: 18, layoffs: null, geography: "Philippines" }, { period: "Jul 2026", active_postings: 21, layoffs: null, geography: "Philippines" }, { period: "Aug 2026", active_postings: 24, layoffs: null, geography: "Philippines" }],
  skill_demand: [
    { skill: "Python", postings: 15, evidenced: true }, { skill: "Git", postings: 14, evidenced: true },
    { skill: "TypeScript", postings: 11, evidenced: true }, { skill: "React", postings: 10, evidenced: true },
    { skill: "Docker", postings: 9, evidenced: false }, { skill: "AWS", postings: 7, evidenced: false }
  ],
  qualification_barriers: [
    { label: "Completed degree required", count: 8, percent: 33 },
    { label: "Degree requirement unknown", count: 7, percent: 29 },
    { label: "2+ years experience", count: 6, percent: 25 },
    { label: "Experience requirement unknown", count: 5, percent: 21 }
  ],
  geography_ratios: [
    { country: "Philippines", mode: "remote", count: 10, percent: 42 },
    { country: "Philippines", mode: "hybrid", count: 8, percent: 33 },
    { country: "Philippines", mode: "onsite", count: 6, percent: 25 }
  ],
  personal_comparison: [],
  salary_bands: [{ band: "below_20k", count: 2 }, { band: "20k_40k", count: 12 }, { band: "40k_80k", count: 7 }, { band: "80k_plus", count: 1 }, { band: "unknown", count: 2 }],
  funnel: [{ name: "Draft → review", successes: 4, resolved: 5, pending: 1, rate: 0.8 }, { name: "Review → demo confirmed", successes: 2, resolved: 3, pending: 1, rate: 0.67 }],
  warnings: ["Versioned synthetic local dataset; it does not describe the live labor market.", "Unknown requirements are not treated as absent requirements."]
};
