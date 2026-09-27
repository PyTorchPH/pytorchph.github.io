"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BriefcaseBusiness, CalendarCheck2, FileCheck2, Flame, Medal, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { PersonalActivityChart, SkillPointsChart } from "@pytorch-ph/domain-client/organization";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card } from "@pytorch-ph/design-system/card";
import { Progress } from "@pytorch-ph/design-system/progress";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import { rankForPoints, type MemberOverview } from "@pytorch-ph/domain-protocol/leaderboards";

export function MemberDashboard() {
  const query = useQuery({ queryKey: ["member-overview"], queryFn: () => fetchJson<MemberOverview>("/api/member/overview", { cache: "no-store" }) });
  const data = query.data;
  const tier = data ? rankForPoints(data.summary.points) : null;
  const progress = tier ? tier.ceiling ? ((data!.summary.points-tier.floor)/(tier.ceiling-tier.floor))*100 : 100 : 0;
  const metrics = data ? [
    ["Verified evidence", data.summary.verifiedEvidence, ShieldCheck], ["Ready resumes", data.summary.readyResumes, FileCheck2], ["Registered events", data.summary.registeredEvents, CalendarCheck2], ["Active opportunities", data.summary.activeOpportunities, BriefcaseBusiness],
  ] as const : [];
  return <AppShell><div className="space-y-4">
    <section className="rounded-2xl border border-border bg-surface p-5 lg:p-7" data-testid="member-dashboard" data-tour="member-overview"><div className="flex flex-wrap items-start justify-between gap-4"><div><Badge className="text-accent" variant="orange">Personal command center</Badge><h1 className="mt-4 text-3xl font-extrabold tracking-[-0.02em]">Your evidence, momentum, and next move.</h1><p className="mt-3 max-w-2xl leading-7 text-muted">This owner-only view combines verified career readiness with your competitive season standing.</p></div><Badge variant={data?.meta.mode === "local_demo" ? "warning" : query.isError ? "warning" : "success"}>{query.isError ? "Live data unavailable" : data?.meta.label || "Loading private overview"}</Badge></div></section>
    {query.isError ? <Card className="bg-surface p-8 text-center"><h2 className="font-bold">Personal overview unavailable</h2><p className="mt-2 text-sm text-muted">No synthetic values are substituted in live mode.</p></Card> : <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-tour="member-metrics">{metrics.map(([label,value,Icon]) => <Card className="bg-surface" key={label}><Icon className="text-accent" size={20}/><p className="mt-5 text-3xl font-bold">{value}</p><p className="mt-1 text-sm text-muted">{label}</p></Card>)}</section>
      <section className="grid gap-4 lg:grid-cols-[.85fr_1.15fr]" data-tour="member-standing">
        <Card className="bg-surface"><div className="flex items-center justify-between"><div><p className="text-sm text-muted">Quarterly standing</p><h2 className="mt-2 text-2xl font-bold">#{data?.summary.rank ?? "—"} · {tier?.tier} {tier?.division}</h2></div><Trophy className="text-accent" size={28}/></div><div className="mt-5 flex items-end justify-between"><p className="font-mono text-3xl font-bold">{data?.summary.points.toLocaleString()}</p><p className="flex items-center gap-1 text-sm text-muted"><Flame className="text-warning" size={16}/>{data?.summary.streak} week streak</p></div><Progress className="mt-3" value={progress}/><p className="mt-2 text-xs text-muted">{tier?.ceiling ? `${tier.ceiling-data!.summary.points} verified points to the next division` : "Master I reached"}</p><Link className="mt-5 flex items-center gap-2 text-sm font-semibold text-accent" href="/leaderboards">Open full ladder <ArrowRight size={14}/></Link></Card>
        <Card className="bg-surface"><h2 className="font-bold">12-week verified activity</h2><p className="mt-1 text-sm text-muted">Only your weighted point events.</p><PersonalActivityChart data={data?.activity || []}/></Card>
      </section>
      <section className="grid gap-4 lg:grid-cols-2"><Card className="bg-surface"><h2 className="font-bold">Verified skill points</h2><p className="mt-1 text-sm text-muted">Approved taxonomy links from verified point events.</p><SkillPointsChart data={data?.skillPoints || []}/></Card><Card className="bg-surface"><h2 className="font-bold">Prerequisite coverage</h2><p className="mt-1 text-sm text-muted">Readiness is evidence-based; unknowns remain open.</p><div className="mt-5 space-y-3">{data?.prerequisites.map((item) => <div className="flex items-center justify-between rounded-lg border border-border p-3" key={item.label}><span>{item.label}</span><Badge variant={item.ready ? "success" : "warning"}>{item.ready ? "Ready" : "Needs evidence"}</Badge></div>)}</div></Card></section>
      <section className="grid gap-4 lg:grid-cols-2"><Card className="bg-surface"><div className="flex items-center gap-2"><Medal className="text-accent"/><h2 className="font-bold">Opportunity stages</h2></div><div className="mt-5 space-y-3">{data?.opportunityStages.map((item) => <div key={item.stage}><div className="mb-1 flex justify-between text-sm"><span>{item.stage}</span><span className="font-mono">{item.count}</span></div><Progress value={Math.min(100,item.count*25)}/></div>)}</div></Card><Card className="bg-surface"><div className="flex items-center gap-2"><Sparkles className="text-accent"/><h2 className="font-bold">Recommended next moves</h2></div><div className="mt-5 space-y-3">{data?.recommendations.map((item) => <p className="rounded-lg border border-border p-3 text-sm leading-6" key={item}>{item}</p>)}</div></Card></section>
      <Card className="overflow-hidden border-accent/20 bg-[linear-gradient(100deg,rgb(var(--accent-rgb)/.1),rgb(var(--surface-rgb)))]" data-tour="member-community"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">Community pulse · privacy-safe aggregates</h2><p className="mt-1 text-sm text-muted">No names, emails, profiles, or small-group breakdowns.</p></div><Badge variant="success">{data?.community.freshness}</Badge></div><div className="mt-5 grid gap-3 sm:grid-cols-3">{[["Active members",data?.community.activeMembers],["Verified point events",data?.community.verifiedPointEvents],["Reviewed evidence",data?.community.reviewedEvidence]].map(([label,value]) => <div className="rounded-lg border border-border bg-elevated p-4" key={label}><p className="font-mono text-2xl font-bold text-accent">{value?.toLocaleString()}</p><p className="mt-1 text-xs text-muted">{label}</p></div>)}</div></Card>
    </>}
  </div></AppShell>;
}
