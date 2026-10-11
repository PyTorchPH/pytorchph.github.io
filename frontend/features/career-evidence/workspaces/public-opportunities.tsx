"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card } from "@pytorch-ph/design-system/card";
import { Input } from "@pytorch-ph/design-system/input";
import { fetchPublicJobs, REMOTIVE_SOURCE } from "../../job-discovery/public-jobs";

export function PublicOpportunities() {
  const [role, setRole] = useState("software");
  const [search, setSearch] = useState("software");
  const query = useQuery({ queryKey: ["public-jobs", search], queryFn: ({ signal }) => fetchPublicJobs(search, signal), staleTime: 5 * 60_000 });
  return <section className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-bold">Live remote jobs</h2><p className="text-xs text-muted">Fetched by this browser from <a className="text-accent underline" href={REMOTIVE_SOURCE} rel="noreferrer" target="_blank">Remotive</a>. No evidence fit score is available yet.</p></div>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(role.trim()); }}><Input aria-label="Search remote jobs" onChange={(event) => setRole(event.target.value)} value={role} /><button className="rounded-lg bg-accent px-3 text-sm font-semibold text-white" type="submit">Search</button></form>
    </div>
    {query.isPending && <p className="text-sm text-muted">Loading public job listings…</p>}
    {query.isError && <p className="text-sm text-warning" role="alert">{query.error instanceof Error ? query.error.message : "Job listings are unavailable."}</p>}
    {query.data && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{query.data.slice(0, 12).map((job) => <Card className="bg-surface" key={job.id}>
      <div className="flex justify-between gap-2"><Badge>Remote</Badge><span className="text-xs text-muted">{job.publication_date.slice(0, 10)}</span></div>
      <h3 className="mt-3 font-semibold">{job.title}</h3><p className="text-sm text-muted">{job.company_name} · {job.candidate_required_location}</p>
      <a className="mt-4 inline-block text-sm font-semibold text-accent underline" href={job.url} rel="noreferrer" target="_blank">View on Remotive</a>
    </Card>)}</div>}
    {query.data?.length === 0 && <p className="text-sm text-muted">No jobs in this public API sample match your search.</p>}
  </section>;
}
