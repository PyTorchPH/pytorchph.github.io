"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card } from "@pytorch-ph/design-system/card";
import { Input } from "@pytorch-ph/design-system/input";
import { fetchPublicJobs, skillMatchedJobs } from "../../job-discovery/public-jobs";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";

export function PublicOpportunities() {
  const [role, setRole] = useState("software");
  const [search, setSearch] = useState("software");
  const query = useQuery({ queryKey: ["public-jobs", search], queryFn: ({ signal }) => fetchPublicJobs(search, signal), staleTime: 5 * 60_000 });
  const evidence = useQuery({ queryKey: ["product", "career-evidence"], queryFn: () => fetchJson<ProductViewData>("/api/product/career-evidence", { cache: "no-store" }) });
  const memberSkills = evidence.data?.evidence?.skills ?? [];
  const matches = query.data ? skillMatchedJobs(query.data, memberSkills) : [];
  return <section className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-bold">Jobs matching your verified skills</h2><p className="text-xs text-muted">Live remote listings supplied by Remotive and ranked against your current evidence.</p></div>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(role.trim()); }}><Input aria-label="Search remote jobs" onChange={(event) => setRole(event.target.value)} value={role} /><button className="rounded-lg bg-accent px-3 text-sm font-semibold text-white" type="submit">Search</button></form>
    </div>
    {query.isPending && <p className="text-sm text-muted">Loading public job listings…</p>}
    {query.isError && <p className="text-sm text-warning" role="alert">{query.error instanceof Error ? query.error.message : "Job listings are unavailable."}</p>}
    {query.data && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{matches.slice(0, 12).map(({ job, matchedSkills }) => <Card className="bg-surface" key={job.id}>
      <div className="flex justify-between gap-2"><Badge>Remote</Badge><span className="text-xs text-muted">{job.publication_date.slice(0, 10)}</span></div>
      <h3 className="mt-3 font-semibold">{job.title}</h3><p className="text-sm text-muted">{job.company_name} · {job.candidate_required_location}</p>
      <p className="mt-3 text-sm"><span className="text-muted">Salary:</span> <strong>{job.salary || "Not listed"}</strong></p>
      <div className="mt-3 flex flex-wrap gap-1">{matchedSkills.map((skill) => <Badge key={skill} variant="success">{skill}</Badge>)}{(job.tags ?? []).filter((tag) => !matchedSkills.includes(tag)).slice(0, 4).map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>
    </Card>)}</div>}
    {query.data && !memberSkills.length && <p className="text-sm text-muted">Add verified skills to your evidence profile to see matched jobs.</p>}
    {query.data && memberSkills.length > 0 && matches.length === 0 && <p className="text-sm text-muted">No current listing matches your verified skills and search.</p>}
  </section>;
}
