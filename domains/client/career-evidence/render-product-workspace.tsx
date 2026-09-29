"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { InfoPopover } from "@pytorch-ph/design-system/info-popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  Database,
  FileCheck2,
  FileText,
  GitBranch,
  LockKeyhole,
  Network,
  Server,
  ShieldCheck,
  Sparkles,
  Target,
  Unplug,
  UserCheck,
} from "lucide-react";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { JobMarketContent } from "@pytorch-ph/domain-client/job-discovery";
import { DeveloperDiagnostics } from "@pytorch-ph/domain-client/organization";
import { CareerEvidenceView, ConnectionsWorkspaceView, ResumeStudioView } from "@pytorch-ph/domain-client/career-evidence";
import { CapabilityGate, CapabilityStatus } from "@pytorch-ph/domain-client/onboarding";
import { useCapability } from "@pytorch-ph/domain-client/onboarding";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { AppDialog } from "@pytorch-ph/design-system/dialog";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { Progress } from "@pytorch-ph/design-system/progress";
import { SegmentedTabs } from "@pytorch-ph/design-system/tabs";
import type { CapabilityKey } from "@pytorch-ph/domain-protocol/identity";
import type { Opportunity, ProductView, ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import { fetchJson, queryKeys } from "@pytorch-ph/domain-client/transport";

type Props = { view: ProductView; capabilityKey: CapabilityKey; safety: string; children?: React.ReactNode };

function SourceBadge({ data }: { data: ProductViewData }) {
  return <Badge variant={data.meta.source === "live" ? "success" : "orange"}><Database size={13} />{data.meta.label}</Badge>;
}

function Header({ data, capabilityKey, notices }: { data: ProductViewData; capabilityKey: CapabilityKey; notices: ReactNode }) {
  return <header className="page-hero flex flex-wrap items-start justify-between gap-4" data-tour="page-heading">
    <div><p className="data-label mb-2 text-xs uppercase tracking-widest text-accent">{data.heading.eyebrow}</p><h1 className="text-3xl font-bold tracking-[-0.02em]">{data.heading.title}</h1><p className="mt-2 max-w-3xl leading-7 text-muted">{data.heading.description}</p></div>
    <div className="flex flex-col items-end gap-2"><div className="flex flex-wrap gap-2" data-tour="service-status"><CapabilityStatus capabilityKey={capabilityKey} /><SourceBadge data={data} /></div>{notices}</div>
  </header>;
}

type Automation = { state: string; reason: string; missing: string[] };

// Page-wide rules live behind hover/tap chips in the hero instead of banners above the content.
function HeroNotices({ safety, automation, view, blockers }: { safety: string; automation: Automation | null; view: ProductView; blockers: string[] }) {
  return <div className="flex flex-wrap justify-end gap-2">
    {blockers.length > 0 && <InfoPopover className="border-warning/50 text-warning" label={`${blockers.length} action${blockers.length === 1 ? "" : "s"} needed`} showLabel title="Evidence blockers">
      <p className="text-muted">These require a real source or human action.</p>
      <ul className="mt-2 space-y-2">{blockers.map((item) => <li className="flex gap-2" key={item}><CircleDot className="mt-1 flex-none text-warning" size={13} />{item}</li>)}</ul>
    </InfoPopover>}
    <span data-tour="permission-boundary"><InfoPopover label="Permission boundary" showLabel title="Permission boundary"><p className="text-muted">{safety}</p></InfoPopover></span>
    {automation && <span data-automation-state={automation.state}><InfoPopover label={automation.state === "available" ? "Automation available" : "Manual mode"} showLabel title={automation.state === "available" ? "Automation available" : "Manual mode"}>
      <p className="text-muted">{automation.reason}</p>
      {automation.state === "locked" && automation.missing.length > 0 && <p className="mt-2 text-xs text-muted">Automated tools require: {automation.missing.join(", ")}. Manual workspace actions remain available.</p>}
    </InfoPopover></span>}
    {view === "resumes" && <InfoPopover label="Read-only snapshot" showLabel title="Read-only normalized snapshot">
      <p className="text-muted">Templates inject approved Career Evidence. They cannot edit the underlying details.</p>
      <Link className="mt-3 inline-flex items-center gap-2 font-semibold text-accent" href="/career/evidence">Edit in Career Evidence <ArrowRight size={15} /></Link>
    </InfoPopover>}
  </div>;
}

function EvidenceView({ data }: { data: ProductViewData }) {
  const evidence = data.evidence;
  if (!evidence) return <Empty title="No evidence view is available" />;
  const steps = [
    { label: "Approved sources", icon: FileText },
    { label: "Retrieval middleman", icon: GitBranch },
    { label: "Normalize + verify", icon: Network },
    { label: "Career database", icon: Database },
  ];
  return <div className="space-y-4">
    <Card className="overflow-hidden border-accent/25 bg-accentSoft">
      <CardHeader><div><CardTitle>Evidence pipeline</CardTitle><CardDescription>Every source follows one controlled route; generated resumes never become source evidence.</CardDescription></div><ShieldCheck className="text-accent" size={20} /></CardHeader>
      <div className="grid gap-2 md:grid-cols-4">{steps.map(({ label, icon: Icon }, index) => <div className="relative rounded-lg border border-border bg-surface p-4" key={label}><div className="mb-3 flex items-center justify-between"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accentSoft text-accent"><Icon size={18} /></span>{index < steps.length - 1 && <ArrowRight className="hidden text-muted md:block" size={16} />}</div><p className="text-sm font-semibold">{label}</p></div>)}</div>
    </Card>
    <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
      <Card className="bg-surface"><CardHeader><div><CardTitle>Source inventory</CardTitle><CardDescription>Status is evidence-specific, not a login shortcut.</CardDescription></div><Badge variant={evidence.ready ? "success" : "warning"}>{evidence.phase}</Badge></CardHeader><div className="space-y-2">{evidence.sources.length ? evidence.sources.map((source) => <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-elevated p-3" key={source.id}><div><p className="font-semibold">{source.label}</p><p className="mt-1 text-xs text-muted">{source.kind}</p></div><Badge variant={source.status === "blocked" ? "warning" : "success"}>{source.status}</Badge></div>) : <EmptyInline text="No approved sources have been added." />}</div></Card>
      <Card className="bg-surface"><CardHeader><div><CardTitle>Verified profile</CardTitle><CardDescription>Only compact normalized facts are exposed here.</CardDescription></div><UserCheck className="text-accent" size={20} /></CardHeader><div className="grid gap-2 sm:grid-cols-2">{evidence.profileFacts.length ? evidence.profileFacts.map((fact) => <div className="rounded-lg border border-border bg-elevated p-3" key={`${fact.label}-${fact.value}`}><p className="text-xs capitalize text-muted">{fact.label}</p><p className="mt-2 break-words text-sm font-semibold">{fact.value}</p></div>) : <EmptyInline text="No verified profile facts yet." />}</div>{evidence.skills.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{evidence.skills.map((skill) => <Badge key={skill}>{skill}</Badge>)}</div>}</Card>
    </section>
  </div>;
}

function ResumeView({ data }: { data: ProductViewData }) {
  return <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.resumes?.length ? data.resumes.map((resume) => <Card className="flex flex-col bg-surface" key={resume.id}><CardHeader><div><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accentSoft text-accent"><FileCheck2 size={20} /></div><CardTitle>{resume.label}</CardTitle><CardDescription>{resume.summary}</CardDescription></div><Badge variant={resume.ready ? "success" : "warning"}>{resume.ready ? "Ready" : "Incomplete"}</Badge></CardHeader><div className="mt-auto grid grid-cols-2 gap-2"><div className="rounded-lg bg-elevated p-3"><p className="data-label text-xl font-bold">{resume.skillGroupCount}</p><p className="text-xs text-muted">skill groups</p></div><div className="rounded-lg bg-elevated p-3"><p className="data-label text-xl font-bold">{resume.projectCount}</p><p className="text-xs text-muted">projects</p></div></div>{resume.formats.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{resume.formats.map((format) => <a className="focus-ring border border-accent/30 bg-accentSoft px-3 py-1.5 text-xs font-semibold text-accent" href={format.url} key={format.label} rel="noreferrer" target="_blank">{format.label}</a>)}</div>}</Card>) : <Empty title="No generated resume artifacts" detail="Run the evidence middleman and resume generator before an artifact can appear here." />}</section>;
}

function OperationsView({ data }: { data: ProductViewData }) {
  const demoAction = useDemoAction("job-operations");
  const operations = data.operations;
  if (!operations) return <Empty title="No application goal is configured" />;
  const percent = operations.target > 0 ? Math.min(100, Math.round(operations.completed / operations.target * 100)) : 0;
  return <section className="grid gap-4 xl:grid-cols-[0.75fr_1.25fr]">
    <Card className="bg-surface"><CardHeader><div><CardTitle>{operations.goalLabel}</CardTitle><CardDescription>Only deterministic confirmation increases this count.</CardDescription></div><Target className="text-accent" size={20} /></CardHeader><p className="data-label text-5xl font-bold">{operations.completed}<span className="text-xl text-muted"> / {operations.target || "—"}</span></p><Progress className="mt-5" value={percent} /><div className="mt-4 flex items-center justify-between text-sm text-muted"><span>{percent}% confirmed</span><span>{operations.activeWorkers} active workers</span></div><div className="mt-5 rounded-lg border border-border bg-elevated p-3 text-xs leading-5 text-muted"><LockKeyhole className="mr-2 inline text-accent" size={14} />Review, upload, Continue, CAPTCHA, and final Submit remain separately gated.</div></Card>
    <Card className="bg-surface"><CardHeader><div><CardTitle>Human review queue</CardTitle><CardDescription>One approval never authorizes another item.</CardDescription></div><Badge variant="orange">HITL</Badge></CardHeader><div className="space-y-3">{operations.reviews.length ? operations.reviews.map((item) => <article className="rounded-lg border border-border bg-elevated p-4" key={item.id}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.title}</p><p className="mt-2 text-sm leading-6 text-muted">{item.detail}</p></div><Badge variant={item.state === "blocked" ? "warning" : "default"}>{item.state}</Badge></div>{item.humanGate && <p className="mt-3 flex items-center gap-2 text-xs text-accent"><UserCheck size={13} />Explicit human approval required</p>}{data.meta.mode === "local_demo" && <Button className="mt-4" disabled={demoAction.isPending} onClick={() => demoAction.mutate({ action: "approve_review", id: item.id })} size="sm" variant="secondary"><UserCheck size={14} />Approve this demo gate</Button>}</article>) : <EmptyInline text="No items are waiting for review." />}</div></Card>
  </section>;
}

function OpportunitiesView({ data, canWrite }: { data: ProductViewData; canWrite: boolean }) {
  const demoAction = useDemoAction("opportunities");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Opportunity | "new" | null>(null);
  const [draft, setDraft] = useState({ company: "", title: "", location: "", workMode: "unknown", stage: "discovered", fit: "" });
  const open = (item: Opportunity | "new") => { setEditing(item); setDraft(item === "new" ? { company: "", title: "", location: "", workMode: "unknown", stage: "discovered", fit: "" } : { company: item.company, title: item.title, location: item.location, workMode: item.workMode, stage: item.stage, fit: item.fit === null ? "" : String(item.fit) }); };
  const save = async () => {
    const url = editing === "new" ? "/api/product/opportunities" : `/api/product/opportunities/${editing?.id}`;
    const response = await fetch(url, { method: editing === "new" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, fit: draft.fit === "" ? null : Number(draft.fit) }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not save opportunity.");
    await queryClient.invalidateQueries({ queryKey: queryKeys.product("opportunities") });
    setEditing(null);
    toast.success("Manual opportunity saved with manual provenance.");
  };
  return <><div className="mb-4 flex justify-end"><Button disabled={!canWrite} onClick={() => open("new")} size="sm"><Target size={15}/>Add manually</Button></div><section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.opportunities?.length ? data.opportunities.map((item) => <Card className="bg-surface" key={item.id}><div className="mb-4 flex items-start justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accentSoft text-accent"><Target size={20} /></div><div className="flex gap-2"><Badge>{(item.recordOrigin || "legacy_unknown").replaceAll("_", " ")}</Badge><Badge>{item.stage.replaceAll("_", " ")}</Badge></div></div><h2 className="font-bold">{item.title}</h2><p className="mt-1 text-sm text-muted">{item.company}</p><div className="mt-5 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-elevated p-3"><p className="text-muted">Location</p><p className="mt-1 font-semibold">{item.location}</p></div><div className="rounded-lg bg-elevated p-3"><p className="text-muted">Work mode</p><p className="mt-1 font-semibold capitalize">{item.workMode}</p></div></div><div className="mt-3 rounded-lg bg-elevated p-3 text-xs"><p className="text-muted">Observed salary</p><p className="mt-1 font-semibold">{item.salaryBand || "Unknown"}</p></div><div className="mt-4 flex items-center justify-between border-t border-border pt-4"><span className="text-xs text-muted">Evidence fit</span><span className="data-label font-bold text-accent">{item.fit === null ? "Unknown" : `${item.fit}%`}</span></div>{item.recordOrigin === "manual" && <Button className="mt-4 w-full" onClick={() => open(item)} size="sm" variant="secondary">Edit manual record</Button>}{data.meta.mode === "local_demo" && item.nextStage && item.recordOrigin !== "manual" && <Button className="mt-4 w-full" disabled={demoAction.isPending} onClick={() => demoAction.mutate({ action: "advance_opportunity", id: item.id })} size="sm">Move to {item.nextStage.replaceAll("_", " ")}</Button>}</Card>) : <Empty title="No opportunities recorded" detail="Add a role manually; automated discovery is optional." />}</section>{editing && <AppDialog description="This record is tagged manual. Automated discovery remains separately gated." onClose={() => setEditing(null)} title={editing === "new" ? "Add opportunity manually" : "Edit manual opportunity"}><div className="space-y-4"><div><Label htmlFor="opp-company">Company</Label><Input id="opp-company" onChange={(event) => setDraft((value) => ({ ...value, company: event.target.value }))} value={draft.company}/></div><div><Label htmlFor="opp-title">Job title</Label><Input id="opp-title" onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} value={draft.title}/></div><div><Label htmlFor="opp-location">Location</Label><Input id="opp-location" onChange={(event) => setDraft((value) => ({ ...value, location: event.target.value }))} value={draft.location}/></div><div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="opp-mode">Work mode</Label><select className="mt-1 w-full rounded-lg border border-border bg-elevated p-2" id="opp-mode" onChange={(event) => setDraft((value) => ({ ...value, workMode: event.target.value }))} value={draft.workMode}>{["unknown","remote","hybrid","onsite","any"].map((value) => <option key={value}>{value}</option>)}</select></div><div><Label htmlFor="opp-fit">Evidence fit (optional)</Label><Input id="opp-fit" max="100" min="0" onChange={(event) => setDraft((value) => ({ ...value, fit: event.target.value }))} type="number" value={draft.fit}/></div></div><Button className="w-full" onClick={() => void save().catch((error) => toast.error(error instanceof Error ? error.message : "Could not save opportunity."))}>Save manual record</Button></div></AppDialog>}</>;
}

function useDemoAction(view: ProductView) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { action: "advance_opportunity" | "approve_review" | "toggle_event"; id: string }) => fetchJson("/api/product/demo-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.product(view) }), queryClient.invalidateQueries({ queryKey: queryKeys.product("dashboard") })]); toast.success("Synthetic workflow updated."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Demo action failed."),
  });
}

function ConnectionsView({ data }: { data: ProductViewData }) {
  return <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.connections?.length ? data.connections.map((item) => { const connected = item.status === "connected"; return <Card className="bg-surface" key={item.id}><CardHeader><div className={`flex h-10 w-10 items-center justify-center rounded-lg ${connected ? "bg-success/10 text-success" : "bg-elevated text-muted"}`}>{connected ? <Server size={20} /> : <Unplug size={20} />}</div><Badge variant={connected ? "success" : item.status === "verification_required" ? "warning" : "default"}>{item.status.replaceAll("_", " ")}</Badge></CardHeader><h2 className="font-bold">{item.label}</h2><p className="mt-1 text-xs uppercase tracking-widest text-muted">{item.category.replaceAll("_", " ")}</p><p className="mt-4 text-sm leading-6 text-muted">{item.detail}</p></Card>; }) : <Empty title="No connection summaries" />}</section>;
}

function AdvisorView({ data }: { data: ProductViewData }) {
  return <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]"><Card className="bg-surface"><CardHeader><div><CardTitle>Evidence-grounded recommendations</CardTitle><CardDescription>Every recommendation identifies its supporting evidence; unsupported advice is omitted.</CardDescription></div><Sparkles className="text-accent" size={20} /></CardHeader><div className="space-y-3">{data.recommendations?.length ? data.recommendations.map((item) => <article className="rounded-lg border border-border bg-elevated p-4" key={item.title}><p className="font-semibold">{item.title}</p><p className="mt-2 text-sm leading-6 text-muted">{item.detail}</p><div className="mt-3 flex flex-wrap gap-2">{item.evidenceIds.map((id) => <Badge key={id}>{id}</Badge>)}</div></article>) : <EmptyInline text="No grounded recommendation is available yet." />}</div></Card><Card className="border-accent/25 bg-accentSoft"><Bot className="text-accent" size={24} /><h2 className="mt-4 font-bold">Advisor boundary</h2><p className="mt-2 text-sm leading-6 text-muted">The advisor can read only bounded normalized evidence. It must abstain when a claim cannot cite an evidence ID.</p></Card></section>;
}

function Empty({ title, detail = "The active provider returned no records for this view." }: { title: string; detail?: string }) {
  return <Card className="col-span-full border-dashed bg-surface py-12 text-center"><Database className="mx-auto text-muted" size={26} /><h2 className="mt-4 font-bold">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm text-muted">{detail}</p></Card>;
}

function EmptyInline({ text }: { text: string }) { return <div className="col-span-full rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted">{text}</div>; }

function ViewBody({ view, data, canWriteEvidence, canScrapeEvidence }: { view: ProductView; data: ProductViewData; canWriteEvidence: boolean; canScrapeEvidence: boolean }) {
  if (view === "career-evidence") return <CareerEvidenceView canAutomate={canScrapeEvidence} canWrite={canWriteEvidence} data={data} />;
  if (view === "resumes") return <ResumeStudioView data={data} />;
  if (view === "job-operations") return <OperationsView data={data} />;
  if (view === "opportunities") return <OpportunitiesView canWrite={true} data={data} />;
  if (view === "connections") return <ConnectionsWorkspaceView data={data} />;
  return <AdvisorView data={data} />;
}

const workspaceTitles: Record<ProductView, string> = {
  dashboard: "Dashboard",
  "career-evidence": "Career Evidence",
  resumes: "Resume Studio",
  "job-operations": "Job automation",
  opportunities: "Opportunities",
  connections: "Connections",
  advisor: "Career Advisor",
};

function ProductContent({ view, capabilityKey, safety, children }: Props) {
  const capability = useCapability(capabilityKey);
  const evidenceWrite = useCapability("evidence_write");
  const evidenceScrape = useCapability("evidence_scrape");
  const resumeGenerate = useCapability("resume_generate");
  const jobDiscovery = useCapability("job_discovery");
  const automation = view === "career-evidence" ? evidenceScrape : view === "resumes" ? resumeGenerate : view === "opportunities" ? jobDiscovery : null;
  const query = useQuery({ enabled: capability.state !== "locked", queryKey: queryKeys.product(view), queryFn: () => fetchJson<ProductViewData>(`/api/product/${view}`, { cache: "no-store" }) });
  const data = query.data || null;
  const error = query.error instanceof Error ? query.error.message : "";
  const notices = <HeroNotices automation={automation} blockers={data?.evidence?.blockers ?? []} safety={safety} view={view} />;
  return <>
    {data ? <Header capabilityKey={capabilityKey} data={data} notices={notices} /> : <header className="page-hero flex items-start justify-between gap-4" data-tour="page-heading"><div><p className="data-label mb-2 text-xs uppercase tracking-widest text-accent">Product workspace</p><h1 className="text-3xl font-bold">{capability.state === "locked" ? workspaceTitles[view] : "Loading workspace…"}</h1>{capability.state === "locked" && <p className="mt-2 max-w-3xl leading-7 text-muted">{capability.reason}</p>}</div><div className="flex flex-col items-end gap-2"><Badge data-tour="service-status">{capability.state === "locked" ? "Locked" : "Checking access"}</Badge>{notices}</div></header>}
    {/* Page-specific panels (e.g. official evidence submission) render inside the shell, below the hero. */}
    {children}
    <div data-tour="service-data"><CapabilityGate capabilityKey={capabilityKey}><div data-tour="page-content">{error ? <Card className="bg-surface"><div className="flex gap-3"><AlertTriangle className="flex-none text-accent" /><div><CardTitle>Product data unavailable</CardTitle><p className="mt-2 text-sm text-muted">{error}</p></div></div></Card> : data ? <><ViewBody canScrapeEvidence={evidenceScrape.state === "available"} canWriteEvidence={evidenceWrite.state === "available"} data={data} view={view} /><div className="mt-4"><DeveloperDiagnostics data={data.diagnostics} /></div></> : <Card className="bg-surface"><div className="flex items-center gap-3 text-muted"><Server className="animate-pulse" size={20} />Connecting to the active data provider…</div></Card>}</div></CapabilityGate></div>
  </>;
}

export function ProductWorkspace(props: Props) { return <AppShell><ProductContent {...props} /></AppShell>; }

type CareerView = "resumes" | "opportunities" | "analytics" | "automation";
type CareerProductView = { value: CareerView; label: string; view: ProductView; capabilityKey: CapabilityKey; safety: string };

const careerViews: Array<{ value: CareerView; label: string } & Partial<CareerProductView>> = [
  { value: "resumes", label: "Resumes", view: "resumes", capabilityKey: "resume_read", safety: "Resume selection and upload are separate actions; no artifact advances without explicit approval." },
  { value: "opportunities", label: "Opportunities", view: "opportunities", capabilityKey: "opportunities_read", safety: "Manual opportunity review stays available. Automated discovery remains separately locked until its prerequisites are verified." },
  { value: "analytics", label: "Job analytics" },
  { value: "automation", label: "Job automation", view: "job-operations", capabilityKey: "application_draft", safety: "Automation never bypasses a CAPTCHA, answers a questionnaire, uploads a file, or submits an application without your approval." },
];

// Resumes, the opportunities they are written for, and the job tools around them live on one page.
export function CareerWorkspace({ initialView = "resumes" }: { initialView?: CareerView }) {
  const [view, setView] = useState<CareerView>(initialView);
  const active = careerViews.find((item) => item.value === view) ?? careerViews[0];
  return <AppShell>
    <div aria-label="Career workspace section" className="mb-5" role="group"><SegmentedTabs items={careerViews.map(({ value, label }) => ({ value, label }))} onChange={setView} value={view} /></div>
    {active.view && active.capabilityKey && active.safety ? <ProductContent capabilityKey={active.capabilityKey} key={view} safety={active.safety} view={active.view} /> : <JobMarketContent />}
  </AppShell>;
}
