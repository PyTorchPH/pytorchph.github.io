"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Database,
  FileCheck2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Trophy,
  Unplug,
  UserRound,
  Users,
  Zap,
} from "lucide-react";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { DeveloperDiagnostics } from "@pytorch-ph/domain-client/organization";
import { useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { ActivityTrendChart, CareerReadinessDonut, DepartmentLoadChart, SkillRadarChart } from "@pytorch-ph/domain-client/organization";
import { KanbanBoard } from "@pytorch-ph/domain-client/organization";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card } from "@pytorch-ph/design-system/card";
import type { CapabilityKey } from "@pytorch-ph/domain-protocol/identity";
import type { AnalyticsState, DashboardAnalytics, ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import { unavailableDashboardAnalytics } from "@pytorch-ph/domain-protocol/career-evidence";
import { fetchJson, queryKeys } from "@pytorch-ph/domain-client/transport";
import { cn, formatRank } from "@pytorch-ph/design-system/merge-classes";

const metricIcons = [Users, Activity, AlertTriangle, CalendarCheck];
const emptyMetricLabels = ["Total Members", "Active Members", "Inactive Members", "Upcoming Events"];
const emptyTrustLabels = ["RLS policy coverage", "AI drafts pending HITL", "Leaderboard refresh", "Public PII exposure"];

type Destination = {
  href: string;
  title: string;
  description: string;
  value: (data: ProductViewData) => string;
  detail: (data: ProductViewData) => string;
  icon: typeof UserRound;
  capability: CapabilityKey;
};

const destinations: Destination[] = [
  { href: "/career/evidence", title: "Evidence readiness", description: "Trace sources through the middleman.", value: (data) => data.evidence?.ready ? "READY" : "SETUP", detail: (data) => `${data.evidence?.sources.length || 0} approved sources`, icon: UserRound, capability: "evidence_read" },
  { href: "/career/resumes", title: "Resume artifacts", description: "Review role-specific generated outputs.", value: (data) => String(data.resumes?.filter((item) => item.ready).length || 0), detail: () => "Human-reviewed artifacts", icon: FileCheck2, capability: "resume_read" },
  { href: "/jobs/analytics", title: "Market snapshot", description: "Compare demand with verified evidence.", value: () => "READ", detail: () => "Analytics is read-only", icon: BarChart3, capability: "analytics_read" },
  { href: "/jobs/automation", title: "Application goal", description: "Monitor safe work and review gates.", value: (data) => `${data.operations?.completed || 0}/${data.operations?.target || 0}`, detail: (data) => `${data.operations?.reviews.length || 0} human reviews`, icon: Bot, capability: "application_draft" },
  { href: "/jobs/opportunities", title: "Target opportunities", description: "Inspect roles and funnel progress.", value: (data) => String(data.opportunities?.length || 0), detail: () => "Manual review available", icon: BriefcaseBusiness, capability: "opportunities_read" },
  { href: "/connections", title: "Provider health", description: "Check approved sessions and services.", value: (data) => String(data.connections?.filter((item) => item.status === "connected").length || 0), detail: () => "Connected providers", icon: Unplug, capability: "connections" },
];

function ModuleBadge({ state }: { state: AnalyticsState }) {
  if (state === "live") return <Badge variant="success"><Database size={13} />Live data</Badge>;
  if (state === "demo") return <Badge variant="orange"><Sparkles size={13} />Prototype data</Badge>;
  return <Badge><Database size={13} />Data unavailable</Badge>;
}

function PanelWatermark({ state }: { state: AnalyticsState }) {
  if (state !== "unavailable") return null;
  return <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"><span className="rounded-full border border-white/10 bg-[#0d0d0d]/85 px-5 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[#FFF7ED]/45 shadow-xl">Data unavailable</span></div>;
}

function MetricRibbon({ module }: { module: DashboardAnalytics["metrics"] }) {
  const rows = module.data.length ? module.data : emptyMetricLabels.map((label) => ({ label, value: "—", delta: "Unavailable", trend: "down" as const }));
  return <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-tour="dashboard-metrics">{rows.map((metric, index) => {
    const Icon = metricIcons[index] || Activity;
    const positive = metric.trend === "up";
    return <Card className="relative min-h-40 overflow-hidden border-white/10 bg-[#141416] p-4 hover:border-[#e8590c]/35" key={metric.label}><PanelWatermark state={module.state} /><div className={cn(module.state === "unavailable" && "opacity-35")}><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-[#FFF7ED]/48">{metric.label}</p><p className="data-label mt-3 text-3xl font-bold text-[#FFF7ED]">{metric.value}</p><p className={cn("mt-2 text-xs", positive ? "text-green-400" : "text-[#fb7185]")}>{metric.delta}{module.state !== "unavailable" && " this cycle"}</p></div><div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#e8590c]/25 bg-[#e8590c]/10 text-[#e8590c]"><Icon size={20} /></div></div></div></Card>;
  })}</section>;
}

function HealthRail({ module }: { module: DashboardAnalytics["trust"] }) {
  const rows = module.data.length ? module.data : emptyTrustLabels.map((label) => ({ label, value: "—", tone: "info" as const }));
  return <Card className="relative min-h-[365px] overflow-hidden border-white/10 bg-[#141416]" data-tour="dashboard-trust"><PanelWatermark state={module.state} /><div className={cn(module.state === "unavailable" && "opacity-35")}><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold tracking-[-0.02em] text-[#FFF7ED]">Trust boundary</h2><p className="mt-1 text-sm text-[#FFF7ED]/50">Safety signals officers should see before dispatch.</p></div><ShieldCheck className="text-[#e8590c]" size={20} /></div><div className="mb-4"><ModuleBadge state={module.state} /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">{rows.map((item) => <div className="rounded-lg border border-white/10 bg-[#0d0d0d] p-3" key={item.label}><div className="mb-3 flex items-center justify-between"><p className="text-xs text-[#FFF7ED]/45">{item.label}</p><span className={cn("h-2 w-2 rounded-full", item.tone === "good" && "bg-green-400", item.tone === "warn" && "bg-yellow-300", item.tone === "info" && "bg-blue-400")} /></div><p className="data-label text-2xl font-bold text-[#FFF7ED]">{item.value}</p></div>)}</div></div></Card>;
}

function ApprovalQueue({ module }: { module: DashboardAnalytics["approvals"] }) {
  return <Card className="relative min-h-[390px] overflow-hidden border-white/10 bg-[#141416]" data-tour="dashboard-approvals"><PanelWatermark state={module.state} /><div className={cn(module.state === "unavailable" && "opacity-35")}><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold tracking-[-0.02em] text-[#FFF7ED]">Approval middleman</h2><p className="mt-1 text-sm text-[#FFF7ED]/50">AI output waits for department review.</p></div><Badge variant="orange">HITL</Badge></div><div className="mb-4"><ModuleBadge state={module.state} /></div><div className="space-y-3">{module.data.map((item) => <article className="rounded-lg border border-white/10 bg-[#0d0d0d] p-3" key={item.id}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold leading-5 text-[#FFF7ED]">{item.title}</p><p className="mt-2 text-xs text-[#FFF7ED]/45">{item.department}</p></div><Badge variant={item.risk === "public" ? "warning" : "default"}>{item.risk}</Badge></div><div className="mt-3 flex items-center justify-between gap-3 text-xs text-[#FFF7ED]/45"><span className="flex items-center gap-1.5"><Clock3 size={13} />{item.age}</span><span>{item.status}</span></div></article>)}</div></div></Card>;
}

function LeaderboardPanel({ module }: { module: DashboardAnalytics["leaderboard"] }) {
  return <Card className="relative min-h-[390px] overflow-hidden border-white/10 bg-[#141416]"><PanelWatermark state={module.state} /><div className={cn(module.state === "unavailable" && "opacity-35")}><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold tracking-[-0.02em] text-[#FFF7ED]">Elite node rank</h2><p className="mt-1 text-sm text-[#FFF7ED]/50">Public-safe handles only.</p></div><Link aria-label="Open leaderboards" className="focus-ring rounded-lg text-[#e8590c]" href="/leaderboards"><Trophy size={20} /></Link></div><div className="mb-4"><ModuleBadge state={module.state} /></div><div className="space-y-2">{module.data.slice(0, 5).map((row) => <div className="flex items-center justify-between rounded-lg border border-white/10 bg-[#0d0d0d] p-3" key={`${row.rank}-${row.name}`}><div className="flex min-w-0 items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e8590c]/30 bg-[#e8590c]/10 font-mono text-xs text-[#e8590c]">{formatRank(row.rank)}</div><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#FFF7ED]">{row.name}</p><p className="truncate text-xs text-[#FFF7ED]/45">{row.track}</p></div></div><p className="data-label text-sm text-[#e8590c]">{row.points.toLocaleString()}</p></div>)}</div></div></Card>;
}

function OperationsHero({ data, loading, error }: { data: ProductViewData; loading: boolean; error: string }) {
  return <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#141416] p-5 lg:p-6" data-tour="dashboard-overview"><div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_0%,rgba(232,89,12,0.22),transparent_32%)]" /><div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><div><div className="mb-4 flex flex-wrap items-center gap-2"><Badge variant="orange"><Sparkles size={14} />Officer command</Badge><Badge>Cycle 2026-Q3</Badge><Badge variant={error ? "warning" : data.meta.source === "live" ? "success" : "orange"}>{error ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}{error ? "Provider unavailable" : loading ? "Loading provider" : data.meta.label}</Badge></div><h1 className="max-w-3xl text-3xl font-extrabold tracking-[-0.02em] text-[#FFF7ED] md:text-4xl">Community intelligence dashboard for chapter operations.</h1><p className="mt-3 max-w-2xl leading-7 text-[#FFF7ED]/58">One surface for member telemetry, event throughput, leaderboard pressure, approval bottlenecks, and AI-assisted briefs.</p></div><div className="grid min-w-[280px] grid-cols-2 gap-3"><div className="rounded-lg border border-white/10 bg-[#0d0d0d] p-3"><p className="text-xs text-[#FFF7ED]/45">Pipeline status</p><p className={cn("data-label mt-2 text-xl font-bold", error ? "text-yellow-300" : "text-green-400")}>{error ? "DEGRADED" : loading ? "LOADING" : data.meta.mode === "local_demo" ? "DEMO" : "LIVE"}</p></div><div className="rounded-lg border border-white/10 bg-[#0d0d0d] p-3"><p className="text-xs text-[#FFF7ED]/45">Risk flags</p><p className="data-label mt-2 text-xl font-bold text-[#e8590c]">{data.analytics?.approvals.data.length ?? "—"}</p></div></div></div></section>;
}

function DestinationCard({ item, data }: { item: Destination; data: ProductViewData }) {
  const manifest = useCapabilities();
  const capability = manifest.capabilities[item.capability];
  const locked = capability.state === "locked";
  const Icon = item.icon;
  const body = <><div className="flex items-start justify-between gap-3"><div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", locked ? "bg-white/[0.04] text-[#FFF7ED]/25" : "bg-[#e8590c]/10 text-[#e8590c]")}><Icon size={20} /></div>{locked ? <LockKeyhole className="text-[#FFF7ED]/25" size={17} /> : <ArrowUpRight className="text-[#FFF7ED]/35" size={17} />}</div><p className="mt-5 text-sm text-[#FFF7ED]/48">{item.title}</p><p className="data-label mt-2 text-3xl font-bold text-[#FFF7ED]">{locked ? "LOCKED" : item.value(data)}</p><p className="mt-3 text-sm leading-6 text-[#FFF7ED]/45">{locked ? capability.reason : item.description}</p><p className="mt-4 border-t border-white/10 pt-3 text-xs text-[#FFF7ED]/35">{locked ? `Required: ${capability.missing.join(", ")}` : item.detail(data)}</p></>;
  if (locked) return <Card aria-disabled="true" className="min-h-64 border-white/10 bg-[#141416] opacity-55" data-capability={item.capability}>{body}</Card>;
  return <Link className="focus-ring group rounded-lg" href={item.href}><Card className="h-full min-h-64 border-white/10 bg-[#141416] group-hover:border-[#e8590c]/40 group-hover:bg-[#171719]">{body}</Card></Link>;
}

function CareerWorkspace({ data }: { data: ProductViewData }) {
  const manifest = useCapabilities();
  const segments = [
    { label: "Evidence", ready: manifest.capabilities.evidence_read.state !== "locked" },
    { label: "Resumes", ready: manifest.capabilities.resume_read.state !== "locked" },
    { label: "Market", ready: manifest.capabilities.opportunities_read.state !== "locked" },
    { label: "Connections", ready: manifest.capabilities.connections.state !== "locked" },
  ];
  return <section className="space-y-4" data-tour="dashboard-career"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="data-label text-xs uppercase tracking-widest text-[#e8590c]">Career workspace</p><h2 className="mt-2 text-2xl font-bold text-[#FFF7ED]">Career readiness and execution</h2><p className="mt-2 text-sm text-[#FFF7ED]/48">Additive career controls—your operations analytics remain intact above.</p></div><Badge><ShieldCheck size={13} />Capability based</Badge></div><div className="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]"><Card className="border-white/10 bg-[#141416]"><h3 className="font-bold text-[#FFF7ED]">Readiness coverage</h3><p className="mt-1 text-sm text-[#FFF7ED]/45">A count of satisfied prerequisites, not a career score.</p><CareerReadinessDonut segments={segments} /><div className="grid grid-cols-2 gap-2">{segments.map((item) => <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0d0d0d] p-2 text-xs" key={item.label}><span className={cn("h-2 w-2 rounded-full", item.ready ? "bg-green-400" : "bg-white/20")} />{item.label}</div>)}</div></Card><div className="grid gap-4 md:grid-cols-2">{destinations.slice(0, 4).map((item) => <DestinationCard data={data} item={item} key={item.href} />)}</div></div><div className="grid gap-4 md:grid-cols-2">{destinations.slice(4).map((item) => <DestinationCard data={data} item={item} key={item.href} />)}</div></section>;
}

function fallbackData(): ProductViewData {
  return {
    meta: { source: "live", provider: "local", mode: "local_demo", synthetic: true, generatedAt: new Date().toISOString(), label: "Connecting" },
    heading: { eyebrow: "Career command center", title: "Career workspace", description: "Provider data is loading." },
    stats: [], analytics: unavailableDashboardAnalytics(),
    evidence: { ready: false, phase: "unavailable", profileFacts: [], sources: [], skills: [], blockers: [] },
    resumes: [], opportunities: [], connections: [],
    operations: { goalLabel: "Application goal", completed: 0, target: 0, activeWorkers: 0, reviews: [] },
  };
}

const DASHBOARD_FALLBACK = fallbackData();

function DashboardContent() {
  const query = useQuery({ queryKey: queryKeys.product("dashboard"), queryFn: () => fetchJson<ProductViewData>("/api/product/dashboard", { cache: "no-store" }) });
  const data = query.data || null;
  const error = query.error instanceof Error ? query.error.message : "";
  const resolved = data || DASHBOARD_FALLBACK;
  const analytics = resolved.analytics || unavailableDashboardAnalytics();
  return <div className="space-y-4"><OperationsHero data={resolved} error={error} loading={!data && !error} /><MetricRibbon module={analytics.metrics} />
    <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]"><Card className="border-white/10 bg-[#141416]" data-tour="dashboard-activity"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold tracking-[-0.02em] text-[#FFF7ED]">Weekly activity pulse</h2><p className="mt-1 text-sm text-[#FFF7ED]/50">Events and member contributions tracked by day.</p></div><div className="flex flex-wrap gap-2"><ModuleBadge state={analytics.activity.state} />{analytics.activity.state !== "unavailable" && <Badge variant="orange"><Zap size={14} />Engagement</Badge>}</div></div><ActivityTrendChart data={analytics.activity.data} state={analytics.activity.state} /></Card><HealthRail module={analytics.trust} /></section>
    <section className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]"><Card className="border-white/10 bg-[#141416]"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold tracking-[-0.02em] text-[#FFF7ED]">Department load</h2><p className="mt-1 text-sm text-[#FFF7ED]/50">Open work versus approved capacity.</p></div><div className="flex items-center gap-2"><ModuleBadge state={analytics.departments.state} /><ArrowUpRight className="text-[#e8590c]" size={20} /></div></div><DepartmentLoadChart data={analytics.departments.data} state={analytics.departments.state} /></Card><Card className="border-white/10 bg-[#141416]"><div className="mb-3 flex justify-end"><div className="flex items-center gap-2"><ModuleBadge state={analytics.events.state} /><Link className="focus-ring rounded-lg text-xs font-semibold text-[#e8590c]" href="/events">Open events</Link></div></div><KanbanBoard data={analytics.events.data} state={analytics.events.state} /></Card></section>
    <section className="grid gap-4 xl:grid-cols-3"><ApprovalQueue module={analytics.approvals} /><LeaderboardPanel module={analytics.leaderboard} /><Card className="border-white/10 bg-[#141416]"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold tracking-[-0.02em] text-[#FFF7ED]">Chapter skill radar</h2><p className="mt-1 text-sm text-[#FFF7ED]/50">Aggregated, anonymous readiness mix.</p></div><Link aria-label="Open career evidence" className="focus-ring rounded-lg text-[#e8590c]" href="/career/evidence"><LockKeyhole size={20} /></Link></div><div className="mb-2"><ModuleBadge state={analytics.skills.state} /></div><SkillRadarChart data={analytics.skills.data} state={analytics.skills.state} /></Card></section>
    <div className="pt-4"><CareerWorkspace data={resolved} /></div>
    <DeveloperDiagnostics data={resolved.diagnostics} />
  </div>;
}

export function DashboardCommandCenter() { return <AppShell><DashboardContent /></AppShell>; }
