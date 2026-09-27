"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, BarChart3, CheckCircle2, Database, Globe2, LockKeyhole } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import type { JobMarketSummary } from "@pytorch-ph/domain-protocol/job-discovery";
import { fetchJson, queryKeys } from "@pytorch-ph/domain-client/transport";
import { jobMarketFilterSchema, type JobMarketFilters } from "@pytorch-ph/domain-protocol/job-discovery";
import { Input } from "@pytorch-ph/design-system/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@pytorch-ph/design-system/table";

const countries = ["Philippines", "Australia", "Canada", "Singapore", "United Kingdom", "United States"];

export function JobMarketDashboard() {
  const { register, watch } = useForm<JobMarketFilters>({ resolver: zodResolver(jobMarketFilterSchema), defaultValues: { country: "Philippines", compareCountry: "", role: "software", mode: "any" } });
  const [country, compareCountry, role, mode] = watch(["country", "compareCountry", "role", "mode"]);
  const selectedCountries = useMemo(() => [country, compareCountry].filter(Boolean), [country, compareCountry]);
  const query = useMemo(() => new URLSearchParams({ countries: selectedCountries.join(","), role_family: role, work_mode: mode, days: "90" }), [selectedCountries, role, mode]);
  const market = useQuery({ queryKey: queryKeys.jobMarket(query.toString()), queryFn: () => fetchJson<JobMarketSummary>(`/api/job-market/summary?${query}`), placeholderData: (previous) => previous });
  const data = market.data || null;
  const error = market.error instanceof Error ? market.error.message : "";
  const loading = market.isFetching;

  return (
    <AppShell>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4" data-tour="analytics-heading">
        <div>
          <div className="data-label mb-2 text-xs uppercase tracking-widest text-accent">Evidence-backed market view</div>
          <h1 className="text-3xl font-bold tracking-[-0.02em]">Job Market Analytics</h1>
          <p className="mt-2 max-w-3xl text-muted">Compare hiring demand and qualification barriers with verified career evidence. Unknown requirements stay unknown.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge><LockKeyhole size={13} /> Read only</Badge>
          <Badge variant={data?.snapshot_kind === "live" ? "success" : "orange"}>
            <Database size={14} /> {data?.snapshot_kind.replaceAll("_", " ") ?? "Loading"}
          </Badge>
        </div>
      </header>

      <Card className="mb-4 bg-surface" data-tour="analytics-filters">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm text-muted">Country<select className="mt-2 w-full rounded-lg border border-border bg-elevated p-2.5 text-ink" {...register("country")}>{countries.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm text-muted">Compare with<select className="mt-2 w-full rounded-lg border border-border bg-elevated p-2.5 text-ink" {...register("compareCountry")}><option value="">No comparison</option>{countries.filter((value) => value !== country).map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm text-muted">Role family<Input className="mt-2" {...register("role")} /></label>
          <label className="text-sm text-muted">Work mode<select className="mt-2 w-full rounded-lg border border-border bg-elevated p-2.5 text-ink" {...register("mode")}>{["any", "remote", "hybrid", "onsite"].map((value) => <option key={value}>{value}</option>)}</select></label>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted"><LockKeyhole size={13} />Filters query existing snapshots only. Refresh and import run through controlled backend ingestion.</p>
      </Card>

      {error && <Card className="mb-4 border-warning/30 bg-warning/10"><div className="flex gap-3"><AlertTriangle className="flex-none text-warning" /><div><strong>Market data unavailable</strong><p className="mt-1 text-sm text-muted">{error}</p></div></div></Card>}
      {data && !loading && <>
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Postings in snapshot" value={data.sample_size} detail={`${data.query.countries.join(", ")} · ${data.query.days} days`} />
          <Metric label="Degree unknown" value={data.unknown_degree_count} detail="Never counted as not required" />
          <Metric label="Experience unknown" value={data.unknown_experience_count} detail="Missing evidence remains visible" />
          <Metric label="Evidence matches" value={data.skill_demand.filter((item) => item.evidenced).length} detail="Top-demand skills in verified profile" />
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-2" data-tour="analytics-market">
          <Card className="bg-surface">
            <CardHeader><div><CardTitle>Active hiring vs. layoffs</CardTitle><CardDescription>Separate descriptive series; coverage and geography must match before comparison.</CardDescription></div><Database className="text-accent" size={20} /></CardHeader>
            <div className="grid gap-3 sm:grid-cols-2">{data.hiring_layoff_series.map((item, index) => <div className="contents" key={`${item.period}-${index}`}><div className="rounded-lg border border-border bg-elevated p-4"><p className="text-sm text-muted">Active postings</p><p className="mt-2 text-3xl font-bold">{item.active_postings ?? "—"}</p><p className="mt-2 text-xs text-muted">{item.geography} · {item.period}</p></div><div className="rounded-lg border border-dashed border-border bg-elevated p-4"><p className="text-sm text-muted">Layoffs / discharges</p><p className="mt-2 text-3xl font-bold">{item.layoffs ?? "Unavailable"}</p><p className="mt-2 text-xs text-muted">Configure a compatible official or imported series.</p></div></div>)}</div>
          </Card>
          <Card className="bg-surface">
            <CardHeader><div><CardTitle>Entry-level skill demand</CardTitle><CardDescription>Posting frequency; orange marks current verified evidence.</CardDescription></div><BarChart3 className="text-accent" size={20} /></CardHeader>
            <div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart accessibilityLayer data={data.skill_demand} layout="vertical" margin={{ left: 20 }}><CartesianGrid stroke="var(--border)" horizontal={false} /><XAxis type="number" stroke="var(--muted)" /><YAxis dataKey="skill" type="category" width={90} stroke="var(--muted)" /><Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)" }} /><Bar dataKey="postings" fill="#e8590c" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div>
          </Card>
          <Card className="bg-surface">
            <CardHeader><div><CardTitle>Degree and experience barriers</CardTitle><CardDescription>Percent of the selected posting sample.</CardDescription></div><AlertTriangle className="text-accent" size={20} /></CardHeader>
            <div className="space-y-4">{data.qualification_barriers.map((item) => <div key={item.label}><div className="mb-2 flex justify-between text-sm"><span>{item.label}</span><span className="data-label text-muted">{item.count} · {item.percent}%</span></div><div className="h-2 overflow-hidden rounded-full bg-elevated"><div className="h-full rounded-full bg-accent" style={{ width: `${item.percent}%` }} /></div></div>)}</div>
          </Card>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-2">
          <Card className="bg-surface"><CardHeader><div><CardTitle>Observed salary bands</CardTitle><CardDescription>Existing application history; unknown salary remains a separate band.</CardDescription></div></CardHeader>{data.salary_bands.length ? <div className="space-y-2">{data.salary_bands.map((item) => <div className="flex justify-between rounded-lg border border-border bg-elevated p-3" key={String(item.band)}><span className="capitalize">{String(item.band).replaceAll("_", " ")}</span><strong>{item.count}</strong></div>)}</div> : <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">No persisted salary evidence is available for the current application history.</p>}</Card>
          <Card className="bg-surface"><CardHeader><div><CardTitle>Application funnel</CardTitle><CardDescription>Conversions appear only after outcomes are resolved; pending work does not count as failure.</CardDescription></div></CardHeader>{data.funnel.length ? <div className="space-y-2">{data.funnel.map((item) => <div className="rounded-lg border border-border bg-elevated p-3" key={String(item.name)}><div className="flex justify-between gap-3"><span>{String(item.name)}</span><strong>{item.rate == null ? "Pending" : `${Math.round(Number(item.rate) * 100)}%`}</strong></div><p className="mt-1 text-xs text-muted">{String(item.successes)} successes · {String(item.resolved)} resolved · {String(item.pending)} pending</p></div>)}</div> : <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">No resolved application-funnel sample is available yet.</p>}</Card>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="bg-surface"><CardHeader><div><CardTitle>Geography and work mode</CardTitle><CardDescription>Ratios remain scoped to each observed country label.</CardDescription></div><Globe2 className="text-accent" size={20} /></CardHeader><Table><TableHeader><TableRow><TableHead>Country / eligibility</TableHead><TableHead>Mode</TableHead><TableHead>Count</TableHead><TableHead>Ratio</TableHead></TableRow></TableHeader><TableBody>{data.geography_ratios.map((item) => <TableRow key={`${item.country}-${item.mode}`}><TableCell>{item.country}</TableCell><TableCell className="capitalize">{item.mode}</TableCell><TableCell>{item.count}</TableCell><TableCell>{item.percent}%</TableCell></TableRow>)}</TableBody></Table></Card>
          <Card className="bg-elevated" data-tour="analytics-evidence"><CardHeader><div><CardTitle>Evidence comparison</CardTitle><CardDescription>Only normalized, evidenced skills are marked present.</CardDescription></div></CardHeader><div className="space-y-2">{data.skill_demand.map((item) => <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-3" key={item.skill}><span>{item.skill}</span>{item.evidenced ? <Badge variant="success"><CheckCircle2 size={13} /> Evidenced</Badge> : <Badge>Gap to review</Badge>}</div>)}</div></Card>
        </section>

        <Card className="mt-4 bg-surface" data-tour="analytics-sources"><CardHeader><div><CardTitle>Sources and limitations</CardTitle><CardDescription>Provenance is part of every interpretation.</CardDescription></div></CardHeader><div className="grid gap-3 lg:grid-cols-2">{data.sources.map((source) => { const content = <><div className="flex items-center justify-between gap-3"><strong>{source.label}</strong><Badge variant={source.configured ? "success" : undefined}>{source.configured ? "Available" : "Not configured"}</Badge></div><p className="mt-2 text-sm text-muted">{source.geography} · {source.freshness}</p></>; return source.attribution_url ? <a className="focus-ring rounded-lg border border-border bg-elevated p-4 hover:border-accent" href={source.attribution_url} key={source.id} rel="noreferrer" target="_blank">{content}</a> : <div className="rounded-lg border border-border bg-elevated p-4" key={source.id}>{content}</div>; })}</div><div className="mt-4 space-y-2 border-t border-border pt-4">{data.warnings.map((warning) => <p className="flex gap-2 text-sm text-muted" key={warning}><AlertTriangle className="mt-0.5 flex-none text-accent" size={15} />{warning}</p>)}</div></Card>
      </>}
    </AppShell>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <Card className="bg-surface"><p className="text-sm text-muted">{label}</p><p className="mt-3 text-3xl font-bold">{value}</p><p className="mt-2 text-xs text-muted">{detail}</p></Card>;
}
