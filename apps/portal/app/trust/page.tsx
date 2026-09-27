"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Database, HardDrive, LockKeyhole, Network, Radio, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { FeedbackReport, MemberPrivacySettings } from "@pytorch-ph/domain-protocol/privacy-feedback";

const nodeDemo = [
  { name: "Vercel orchestrator", detail: "Health checks + signed dispatch", status: "online" },
  { name: "Supabase authority", detail: "Verified day-to-day records", status: "online" },
  { name: "Officer node Manila-01", detail: "Replica witness · 18s behind", status: "proposed" },
  { name: "Officer node Manila-02", detail: "Replica witness · offline", status: "proposed" },
];

function TrustContent() {
  const manifest = useCapabilities();
  const officer = manifest.portal.audience === "officer";
  const client = useQueryClient();
  const privacy = useQuery({ queryKey: ["member-privacy"], queryFn: () => fetchJson<MemberPrivacySettings>("/api/member/privacy", { cache: "no-store" }) });
  const reports = useQuery({ queryKey: ["feedback-reports"], queryFn: () => fetchJson<FeedbackReport[]>("/api/feedback", { cache: "no-store" }) });
  const [draft, setDraft] = useState<MemberPrivacySettings | null>(null);
  useEffect(() => { if (privacy.data) setDraft(privacy.data); }, [privacy.data]);
  const save = useMutation({
    mutationFn: (value: MemberPrivacySettings) => fetchJson<MemberPrivacySettings>("/api/member/privacy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
    onSuccess: (value) => { client.setQueryData(["member-privacy"], value); toast.success("Privacy controls saved."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Privacy settings failed."),
  });
  const toggles: Array<[keyof MemberPrivacySettings, string, string]> = [
    ["hideGoogleIdentity", "Hide Google identity", "OAuth email and provider identity stay out of member-facing views."],
    ["hideRealName", "Hide real name", "Use only the selected leaderboard label outside owner/officer-authorized workflows."],
    ["anonymousRanking", "Anonymous seasonal ranking", "Use a season-scoped alias while preserving your highlighted own row."],
    ["deviceCacheEnabled", "Persistent device vault", "Allow reviewed manual data to remain encrypted in this browser profile."],
    ["automaticErrorReports", "Privacy-safe automatic errors", "Send redacted error metadata without HTML, screenshots, or form values."],
  ];
  return <div className="space-y-5">
    <section className="overflow-hidden rounded-2xl border border-accent/30 bg-[radial-gradient(circle_at_top_right,rgb(var(--accent-rgb)/.1),transparent_35%),rgb(var(--surface-rgb))] p-6 lg:p-8" data-testid="trust-center">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><Badge variant="orange">Trust, privacy & resilience</Badge><h1 className="mt-4 text-3xl font-extrabold">{officer ? "Officer integrity console" : "Your privacy command center"}</h1><p className="mt-3 max-w-3xl leading-7 text-muted">{officer ? "Observe authoritative storage, proposed replica witnesses, feedback health, and explicit integrity boundaries." : "Choose what leaves your device, what other members see, and how your own ranking stays recognizable only to you."}</p></div><ShieldCheck className="text-accent" size={38} /></div>
    </section>

    <section className="grid gap-4 lg:grid-cols-3">
      <Card className="bg-surface"><Database className="text-success" /><h2 className="mt-4 font-bold">Supabase is authoritative</h2><p className="mt-2 text-sm leading-6 text-muted">Scraper-sourced, server-validated events receive provenance and append-only audit records.</p></Card>
      <Card className="bg-surface"><HardDrive className="text-accent" /><h2 className="mt-4 font-bold">Device data is untrusted input</h2><p className="mt-2 text-sm leading-6 text-muted">Manual browser data may persist, but never becomes verified merely because it was synchronized.</p></Card>
      <Card className="bg-surface"><Network className="text-warning" /><h2 className="mt-4 font-bold">Officer replicas are witnesses</h2><p className="mt-2 text-sm leading-6 text-muted">Proposed nodes compare signed manifests and freshness; they do not silently read member caches or outvote Supabase.</p></Card>
    </section>

    <section className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
      <Card className="bg-surface"><CardHeader><div><CardTitle>{officer ? "Replica quorum preview" : "Personal visibility controls"}</CardTitle><CardDescription>{officer ? "Architecture preview only—officer peer replication is not enabled." : "These settings persist in the local demo and map to owner-only Supabase fields in production."}</CardDescription></div>{officer ? <Radio className="text-accent" /> : <LockKeyhole className="text-accent" />}</CardHeader>
        {officer ? <div className="space-y-2">{nodeDemo.map((node) => <div className="flex items-center justify-between rounded-lg border border-border p-3" key={node.name}><div><p className="font-semibold">{node.name}</p><p className="mt-1 text-xs text-muted">{node.detail}</p></div><Badge variant={node.status === "online" ? "success" : "warning"}>{node.status}</Badge></div>)}</div> : draft ? <div className="space-y-2">{toggles.map(([key,label,detail]) => <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3" key={key}><input checked={draft[key]} className="mt-1 accent-accent" onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} type="checkbox" /><span><span className="block font-semibold">{label}</span><span className="mt-1 block text-xs leading-5 text-muted">{detail}</span></span></label>)}<Button className="mt-3 w-full" disabled={save.isPending} onClick={() => save.mutate(draft)}>{save.isPending ? "Saving…" : "Save privacy controls"}</Button></div> : <p className="text-sm text-muted">Loading owner-only controls…</p>}
      </Card>
      <Card className="bg-surface"><CardHeader><div><CardTitle>{officer ? "Incoming feedback" : "Your feedback receipts"}</CardTitle><CardDescription>Structured diagnostics exclude raw HTML, screenshots, credentials, and local cache content.</CardDescription></div><Activity className="text-accent" /></CardHeader><div className="space-y-2">{reports.data?.slice(0,6).map((report) => <div className="rounded-lg border border-border p-3" key={report.id}><div className="flex items-center justify-between"><span className="font-semibold capitalize">{report.category.replaceAll("_", " ")}</span><Badge>{report.status}</Badge></div><p className="mt-1 text-xs text-muted">{report.route} · {report.id.slice(0,8).toUpperCase()}</p></div>)}{!reports.data?.length && <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">No reports yet. Use the Report button to test the feedback loop.</p>}</div></Card>
    </section>

    <Card className="border-warning/30 bg-warning/10"><div className="flex gap-3"><TriangleAlert className="flex-none text-warning" /><div><h2 className="font-bold">Known limitation</h2><p className="mt-2 text-sm leading-6 text-muted">A member controls their browser and can alter local storage. Local/manual claims therefore remain unverified until a server-owned source or officer-reviewed workflow produces a signed provenance event. Covert officer access to a member device is intentionally prohibited.</p></div></div></Card>
  </div>;
}

export default function TrustPage() { return <AppShell><TrustContent /></AppShell>; }
