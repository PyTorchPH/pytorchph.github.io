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
import { FilipinoPhrase } from "@pytorch-ph/design-system/filipino-phrase";

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
  return <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"><span className="rounded-full border border-border bg-canvas/85 px-5 py-2 font-mono text-xs uppercase tracking-[0.18em] text-muted shadow-xl">Data unavailable</span></div>;
}

function MetricRibbon({ module }: { module: DashboardAnalytics["metrics"] }) {
  const rows = module.data.length ? module.data : emptyMetricLabels.map((label) => ({ label, value: "—", delta: "Unavailable", trend: "down" as const }));
  return <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-tour="dashboard-metrics">{rows.map((metric, index) => {
    const Icon = metricIcons[index] || Activity;
    const positive = metric.trend === "up";
    return <Card className="relative min-h-40 overflow-hidden border-border bg-surface p-4 hover:border-accent/35" key={metric.label}><PanelWatermark state={module.state} /><div className={cn(module.state === "unavailable" && "opacity-35")}><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-muted">{metric.label}</p><p className="data-label mt-3 text-3xl font-bold text-ink">{metric.value}</p><p className={cn("mt-2 text-xs", positive ? "text-success" : "text-danger")}>{metric.delta}{module.state !== "unavailable" && " this cycle"}</p></div><div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent"><Icon size={20} /></div></div></div></Card>;
  })}</section>;
}

function HealthRail({ module }: { module: DashboardAnalytics["trust"] }) {
  const rows = module.data.length ? module.data : emptyTrustLabels.map((label) => ({ label, value: "—", tone: "info" as const }));
  return <Card className="relative min-h-[365px] overflow-hidden border-border bg-surface" data-tour="dashboard-trust"><PanelWatermark state={module.state} /><div className={cn(module.state === "unavailable" && "opacity-35")}><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold tracking-[-0.02em] text-ink">Trust boundary</h2><p className="mt-1 text-sm text-muted">Safety signals officers should see before dispatch.</p></div><ShieldCheck className="text-accent" size={20} /></div><div className="mb-4"><ModuleBadge state={module.state} /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">{rows.map((item) => <div className="rounded-lg border border-border bg-canvas p-3" key={item.label}><div className="mb-3 flex items-center justify-between"><p className="text-xs text-muted">{item.label}</p><span className={cn("h-2 w-2 rounded-full", item.tone === "good" && "bg-success", item.tone === "warn" && "bg-warning", item.tone === "info" && "bg-info")} /></div><p className="data-label text-2xl font-bold text-ink">{item.value}</p></div>)}</div></div></Card>;
}

function ApprovalQueue({ module }: { module: DashboardAnalytics["approvals"] }) {
  return <Card className="relative min-h-[390px] overflow-hidden border-border bg-surface" data-tour="dashboard-approvals"><PanelWatermark state={module.state} /><div className={cn(module.state === "unavailable" && "opacity-35")}><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold tracking-[-0.02em] text-ink">Approval middleman</h2><p className="mt-1 text-sm text-muted">AI output waits for department review.</p></div><Badge variant="orange">HITL</Badge></div><div className="mb-4"><ModuleBadge state={module.state} /></div><div className="space-y-3">{module.data.map((item) => <article className="rounded-lg border border-border bg-canvas p-3" key={item.id}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold leading-5 text-ink">{item.title}</p><p className="mt-2 text-xs text-muted">{item.department}</p></div><Badge variant={item.risk === "public" ? "warning" : "default"}>{item.risk}</Badge></div><div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted"><span className="flex items-center gap-1.5"><Clock3 size={13} />{item.age}</span><span>{item.status}</span></div></article>)}</div></div></Card>;
}

function OperationsHero({ data, loading, error }: { data: ProductViewData; loading: boolean; error: string }) {
  return <section className="relative overflow-hidden rounded-2xl border border-border bg-surface p-5 lg:p-6" data-tour="dashboard-overview"><div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_0%,rgb(var(--accent-rgb)/.1),transparent_32%)]" /><div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><div><div className="mb-4 flex flex-wrap items-center gap-2"><Badge variant="orange"><Sparkles size={14} />Officer command</Badge><Badge>Cycle 2026-Q3</Badge><Badge variant={error ? "warning" : data.meta.source === "live" ? "success" : "orange"}>{error ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}{error ? "Provider unavailable" : loading ? "Loading provider" : data.meta.label}</Badge></div><FilipinoPhrase className="mb-1" meaning="We move the community forward together." phrase="Bayanihan" /><h1 className="max-w-3xl text-3xl font-extrabold tracking-[-0.02em] text-ink md:text-4xl">Community intelligence dashboard for chapter operations.</h1><p className="mt-3 max-w-2xl leading-7 text-muted">One surface for member telemetry, event throughput, leaderboard pressure, approval bottlenecks, and AI-assisted briefs.</p></div><div className="grid min-w-[280px] grid-cols-2 gap-3"><div className="rounded-lg border border-border bg-canvas p-3"><p className="text-xs text-muted">Pipeline status</p><p className={cn("data-label mt-2 text-xl font-bold", error ? "text-warning" : "text-success")}>{error ? "DEGRADED" : loading ? "LOADING" : data.meta.mode === "local_demo" ? "DEMO" : "LIVE"}</p></div><div className="rounded-lg border border-border bg-canvas p-3"><p className="text-xs text-muted">Risk flags</p><p className="data-label mt-2 text-xl font-bold text-accent">{data.analytics?.approvals.data.length ?? "—"}</p></div></div></div></section>;
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
    <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]"><Card className="border-border bg-surface" data-tour="dashboard-activity"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold tracking-[-0.02em] text-ink">Weekly activity pulse</h2><p className="mt-1 text-sm text-muted">Events and member contributions tracked by day.</p></div><div className="flex flex-wrap gap-2"><ModuleBadge state={analytics.activity.state} />{analytics.activity.state !== "unavailable" && <Badge variant="orange"><Zap size={14} />Engagement</Badge>}</div></div><ActivityTrendChart data={analytics.activity.data} state={analytics.activity.state} /></Card><HealthRail module={analytics.trust} /></section>
    <section className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]"><Card className="border-border bg-surface"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold tracking-[-0.02em] text-ink">Department load</h2><p className="mt-1 text-sm text-muted">Open work versus approved capacity.</p></div><div className="flex items-center gap-2"><ModuleBadge state={analytics.departments.state} /><ArrowUpRight className="text-accent" size={20} /></div></div><DepartmentLoadChart data={analytics.departments.data} state={analytics.departments.state} /></Card><Card className="border-border bg-surface"><div className="mb-3 flex justify-end"><div className="flex items-center gap-2"><ModuleBadge state={analytics.events.state} /><Link className="focus-ring rounded-lg text-xs font-semibold text-accent" href="/events">Open events</Link></div></div><KanbanBoard data={analytics.events.data} state={analytics.events.state} /></Card></section>
    <section className="grid gap-4 xl:grid-cols-2"><ApprovalQueue module={analytics.approvals} /><Card className="border-border bg-surface"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold tracking-[-0.02em] text-ink">Chapter skill radar</h2><p className="mt-1 text-sm text-muted">Aggregated, anonymous readiness mix.</p></div><Link aria-label="Open career evidence" className="focus-ring rounded-lg text-accent" href="/career/evidence"><LockKeyhole size={20} /></Link></div><div className="mb-2"><ModuleBadge state={analytics.skills.state} /></div><SkillRadarChart data={analytics.skills.data} state={analytics.skills.state} /></Card></section>
    <DeveloperDiagnostics data={resolved.diagnostics} />
  </div>;
}

export function DashboardCommandCenter() { return <AppShell><DashboardContent /></AppShell>; }
