// Network calls for the member profile, its reference lists, and officer demographics.
// Module map:
//   PROFILE_QUERY_KEY / PROFILE_OPTIONS_QUERY_KEY / DEMOGRAPHICS_QUERY_KEY   react-query cache keys
//   fetchProfile / saveProfile          GET / PUT /api/member/profile (portal, proxied in the static demo)
//   fetchProfileOptions                 GET {API_ORIGIN}/reference/profile-options
//   searchSchools / searchCompanies     GET {API_ORIGIN}/reference/{schools,companies}?q=&limit=20
//   fetchPrograms                       GET {API_ORIGIN}/reference/programs?level=&q= (whole short lists)
//   fetchDemographics                   GET /api/officer/demographics
//   referenceUrl                        builds a reference URL on the auth API origin

import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { CompanyOption, Demographics, ProfileInput, ProfileOptions, ProfileStatus, ProgramOption, SchoolOption } from "@pytorch-ph/domain-protocol/identity";

export const PROFILE_QUERY_KEY = ["member-profile"] as const;
export const PROFILE_OPTIONS_QUERY_KEY = ["member-profile", "options"] as const;
export const DEMOGRAPHICS_QUERY_KEY = ["officer-demographics"] as const;

export const SEARCH_LIMIT = 20;
// Same origin rule as credentials/official-auth.ts: reference data is public and lives on the auth API.
const API_ORIGIN = (process.env.NEXT_PUBLIC_AUTH_API_ORIGIN ?? process.env.NEXT_PUBLIC_API_ORIGIN ?? "").replace(/\/$/, "");

export function fetchProfile(): Promise<ProfileStatus> {
  return fetchJson<ProfileStatus>("/api/member/profile", { credentials: "include" });
}

export function saveProfile(input: ProfileInput): Promise<ProfileStatus> {
  return fetchJson<ProfileStatus>("/api/member/profile", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function fetchProfileOptions(): Promise<ProfileOptions> {
  return fetchJson<ProfileOptions>(referenceUrl("profile-options"));
}

export function searchSchools(query: string): Promise<SchoolOption[]> {
  return fetchJson<SchoolOption[]>(referenceUrl("schools", query));
}

// Short levels (junior/senior high) return their whole list when query is empty.
export function fetchPrograms(level: string, query = ""): Promise<ProgramOption[]> {
  const params = new URLSearchParams({ level, q: query.trim(), limit: String(SEARCH_LIMIT) });
  return fetchJson<ProgramOption[]>(`${API_ORIGIN}/reference/programs?${params}`);
}

export function searchCompanies(query: string): Promise<CompanyOption[]> {
  return fetchJson<CompanyOption[]>(referenceUrl("companies", query));
}

export function fetchDemographics(): Promise<Demographics> {
  return fetchJson<Demographics>("/api/officer/demographics", { credentials: "include" });
}

function referenceUrl(list: string, query?: string): string {
  const base = `${API_ORIGIN}/reference/${list}`;
  if (query === undefined) return base;
  return `${base}?${new URLSearchParams({ q: query.trim(), limit: String(SEARCH_LIMIT) })}`;
}
