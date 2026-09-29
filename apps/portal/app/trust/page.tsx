"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Database, HardDrive, LockKeyhole, Network, Radio, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import { PrivacyControls } from "@pytorch-ph/domain-client/privacy-feedback";
import type { FeedbackReport } from "@pytorch-ph/domain-protocol/privacy-feedback";

const nodeDemo = [
  { name: "Vercel orchestrator", detail: "Health checks + signed dispatch", status: "online" },
  { name: "Rust API authority", detail: "Verified day-to-day records", status: "online" },
  { name: "Officer node Manila-01", detail: "Replica witness · 18s behind", status: "proposed" },
  { name: "Officer node Manila-02", detail: "Replica witness · offline", status: "proposed" },
];

function TrustContent() {
  const manifest = useCapabilities();
  const officer = manifest.portal.audience === "officer";
  const reports = useQuery({ queryKey: ["feedback-reports"], queryFn: () => fetchJson<FeedbackReport[]>("/api/feedback", { cache: "no-store" }) });
  return <div className="space-y-5">
    <section className="page-hero" data-testid="trust-center">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><Link className="text-sm font-semibold text-accent underline underline-offset-2" href="/settings#privacy">Back to Settings</Link><div className="mt-3"><Badge variant="orange">Trust, privacy & resilience</Badge></div><h1 className="mt-4 text-3xl font-extrabold">{officer ? "Officer integrity console" : "Your privacy command center"}</h1><p className="mt-3 max-w-3xl leading-7 text-muted">{officer ? "Observe authoritative storage, proposed replica witnesses, feedback health, and explicit integrity boundaries." : "Choose what leaves your device, what other members see, and how your own ranking stays recognizable only to you."}</p></div><ShieldCheck className="text-accent" size={38} /></div>
    </section>

    <section className="grid gap-4 lg:grid-cols-3">
      <Card className="bg-surface"><Database className="text-success" /><h2 className="mt-4 font-bold">The Rust API is authoritative</h2><p className="mt-2 text-sm leading-6 text-muted">Scraper-sourced, server-validated events receive provenance and append-only audit records.</p></Card>
      <Card className="bg-surface"><HardDrive className="text-accent" /><h2 className="mt-4 font-bold">Device data is untrusted input</h2><p className="mt-2 text-sm leading-6 text-muted">Manual browser data may persist, but never becomes verified merely because it was synchronized.</p></Card>
      <Card className="bg-surface"><Network className="text-warning" /><h2 className="mt-4 font-bold">Officer replicas are witnesses</h2><p className="mt-2 text-sm leading-6 text-muted">Proposed nodes compare signed manifests and freshness; they do not silently read member caches or outvote the Rust API.</p></Card>
    </section>

    <section className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
      <Card className="bg-surface"><CardHeader><div><CardTitle>{officer ? "Replica quorum preview" : "Personal visibility controls"}</CardTitle><CardDescription>{officer ? "Architecture preview only—officer peer replication is not enabled." : "These settings persist in the local demo and map to owner-only Rust API fields in production."}</CardDescription></div>{officer ? <Radio className="text-accent" /> : <LockKeyhole className="text-accent" />}</CardHeader>
        {officer ? <div className="space-y-2">{nodeDemo.map((node) => <div className="flex items-center justify-between rounded-lg border border-border p-3" key={node.name}><div><p className="font-semibold">{node.name}</p><p className="mt-1 text-xs text-muted">{node.detail}</p></div><Badge variant={node.status === "online" ? "success" : "warning"}>{node.status}</Badge></div>)}</div> : <PrivacyControls />}
      </Card>
      <Card className="bg-surface"><CardHeader><div><CardTitle>{officer ? "Incoming feedback" : "Your feedback receipts"}</CardTitle><CardDescription>Structured diagnostics exclude raw HTML, screenshots, credentials, and local cache content.</CardDescription></div><Activity className="text-accent" /></CardHeader><div className="space-y-2">{reports.data?.slice(0,6).map((report) => <div className="rounded-lg border border-border p-3" key={report.id}><div className="flex items-center justify-between"><span className="font-semibold capitalize">{report.category.replaceAll("_", " ")}</span><Badge>{report.status}</Badge></div><p className="mt-1 text-xs text-muted">{report.route} · {report.id.slice(0,8).toUpperCase()}</p></div>)}{!reports.data?.length && <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">No reports yet. Use the Report button to test the feedback loop.</p>}</div></Card>
    </section>

    <Card className="border-warning/30 bg-warning/10"><div className="flex gap-3"><TriangleAlert className="flex-none text-warning" /><div><h2 className="font-bold">Known limitation</h2><p className="mt-2 text-sm leading-6 text-muted">A member controls their browser and can alter local storage. Local/manual claims therefore remain unverified until a server-owned source or officer-reviewed workflow produces a signed provenance event. Covert officer access to a member device is intentionally prohibited.</p></div></div></Card>
  </div>;
}

export default function TrustPage() { return <AppShell><TrustContent /></AppShell>; }
