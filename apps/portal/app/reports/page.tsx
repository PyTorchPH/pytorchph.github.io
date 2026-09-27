"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Filter, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@pytorch-ph/design-system/table";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { FeedbackReport, FeedbackReportPage, FeedbackUpdate } from "@pytorch-ph/domain-protocol/privacy-feedback";

const statuses: FeedbackReport["status"][] = ["received", "triaged", "in_progress", "resolved", "dismissed"];

function ReportsContent() {
  const client = useQueryClient();
  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [portal, setPortal] = useState("all");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const queryString = useMemo(() => {
    const params = new URLSearchParams({ paginated: "1", limit: "25" });
    if (status !== "all") params.set("status", status);
    if (severity !== "all") params.set("severity", severity);
    if (portal !== "all") params.set("portal", portal);
    if (search.trim()) params.set("search", search.trim());
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }, [cursor, portal, search, severity, status]);
  const query = useQuery({ queryKey: ["officer-reports", queryString], queryFn: () => fetchJson<FeedbackReportPage>(`/api/feedback?${queryString}`, { cache: "no-store" }) });
  const [selected, setSelected] = useState<FeedbackReport | null>(null);
  const [note, setNote] = useState("");
  const rows = query.data?.items || [];
  const update = useMutation({
    mutationFn: ({ id, value }: { id: string; value: FeedbackUpdate }) => fetchJson<FeedbackReport>(`/api/feedback/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
    onSuccess: async (value) => { setSelected(value); await client.invalidateQueries({ queryKey: ["officer-reports"] }); toast.success("Report workflow updated."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Update failed."),
  });
  const transition = (next: FeedbackReport["status"]) => selected && update.mutate({ id: selected.id, value: { status: next, severity: selected.severity, assignedTo: selected.assignedTo, resolution: next === "resolved" ? selected.resolution || "Reviewed and resolved by an officer." : selected.resolution } });
  const addNote = useMutation({ mutationFn: ({ id, body }: { id: string; body: string }) => fetchJson(`/api/feedback/${id}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) }), onSuccess: () => { setNote(""); toast.success("Internal note added."); }, onError: (error) => toast.error(error instanceof Error ? error.message : "Note failed.") });
  return <div className="space-y-5">
    <section className="rounded-2xl border border-accent/30 bg-[radial-gradient(circle_at_top_right,rgb(var(--accent-rgb)/.1),transparent_35%),rgb(var(--surface-rgb))] p-6 lg:p-8"><Badge variant="orange">Officer only</Badge><div className="mt-4 flex items-start gap-4"><ClipboardList className="text-accent" size={36}/><div><h1 className="text-3xl font-extrabold">Reports & feedback</h1><p className="mt-2 max-w-3xl text-muted">Triage every member and officer report. Diagnostics remain privacy-bounded and every workflow change is attributable.</p></div></div></section>
    <section className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
      <Card className="bg-surface"><div className="mb-4 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Reports <span className="text-muted">({rows.length} on this page)</span></h2><Filter className="text-muted" size={16}/></div><div className="grid gap-2 md:grid-cols-4"><input aria-label="Search reports" className="rounded-md border border-border bg-elevated px-3 py-2 text-sm" onChange={(event) => { setCursor(null); setSearch(event.target.value); }} placeholder="Search reporter, issue, route" value={search}/><select aria-label="Filter status" className="rounded-md border border-border bg-elevated px-3 py-2 text-sm" onChange={(event) => { setCursor(null); setStatus(event.target.value); }} value={status}><option value="all">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select><select aria-label="Filter severity" className="rounded-md border border-border bg-elevated px-3 py-2 text-sm" onChange={(event) => { setCursor(null); setSeverity(event.target.value); }} value={severity}><option value="all">All severities</option>{["low","medium","high","critical"].map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Filter portal" className="rounded-md border border-border bg-elevated px-3 py-2 text-sm" onChange={(event) => { setCursor(null); setPortal(event.target.value); }} value={portal}><option value="all">All portals</option><option value="member">member</option><option value="officer">officer</option></select></div></div>
        <Table><TableHeader><TableRow><TableHead>Reporter</TableHead><TableHead>Issue</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{rows.map((report) => <TableRow className="cursor-pointer" key={report.id} onClick={() => setSelected(report)}><TableCell><p className="font-semibold">{report.reporterLabel}</p><p className="text-xs text-muted">{report.portal}</p></TableCell><TableCell><p className="font-semibold capitalize">{report.category.replaceAll("_", " ")}</p><p className="max-w-md truncate text-xs text-muted">{report.description || report.route}</p></TableCell><TableCell><Badge variant={report.severity === "critical" || report.severity === "high" ? "warning" : "default"}>{report.severity}</Badge></TableCell><TableCell><Badge>{report.status.replaceAll("_", " ")}</Badge></TableCell></TableRow>)}</TableBody></Table>
        <div className="mt-4 flex justify-end"><Button disabled={!query.data?.nextCursor} onClick={() => query.data?.nextCursor && setCursor(query.data.nextCursor)} size="sm" variant="secondary">Next page</Button></div>
      </Card>
      <Card className="bg-surface">{selected ? <div className="space-y-4"><div><p className="text-xs uppercase tracking-widest text-muted">{selected.id}</p><h2 className="mt-2 text-xl font-bold capitalize">{selected.category.replaceAll("_", " ")}</h2></div><p className="rounded-lg border border-border bg-elevated p-3 text-sm leading-6">{selected.description || "Automatic report with no member description."}</p><dl className="space-y-2 text-sm"><div><dt className="text-muted">Reporter</dt><dd>{selected.reporterLabel}</dd></div><div><dt className="text-muted">Route</dt><dd>{selected.route}</dd></div><div><dt className="text-muted">Viewport</dt><dd>{selected.uiState.viewport}</dd></div><div><dt className="text-muted">Updated</dt><dd>{new Date(selected.updatedAt).toLocaleString()}</dd></div></dl><label className="block text-sm"><span className="text-muted">Severity</span><select className="mt-1 w-full rounded-md border border-border bg-elevated px-3 py-2" onChange={(event) => update.mutate({ id: selected.id, value: { status: selected.status, severity: event.target.value as FeedbackReport["severity"], assignedTo: selected.assignedTo, resolution: selected.resolution } })} value={selected.severity}>{["low","medium","high","critical"].map((item) => <option key={item}>{item}</option>)}</select></label><div className="grid grid-cols-2 gap-2"><Button onClick={() => { const value = window.prompt("Officer UUID to assign (leave empty to unassign)", selected.assignedTo || ""); if (value !== null) update.mutate({ id: selected.id, value: { status: selected.status, severity: selected.severity, assignedTo: value.trim() || null, resolution: selected.resolution } }); }} size="sm" variant="secondary">Assign officer</Button><Button onClick={() => { const value = window.prompt("Resolution note", selected.resolution || ""); if (value !== null) update.mutate({ id: selected.id, value: { status: selected.status, severity: selected.severity, assignedTo: selected.assignedTo, resolution: value.trim() || null } }); }} size="sm" variant="secondary">Edit resolution</Button></div><div className="grid grid-cols-2 gap-2">{statuses.map((item) => <Button disabled={update.isPending || item === selected.status} key={item} onClick={() => transition(item)} size="sm" variant={item === "resolved" ? "primary" : "secondary"}>{item.replaceAll("_", " ")}</Button>)}</div><div className="space-y-2"><textarea aria-label="Internal note" className="min-h-20 w-full rounded-md border border-border bg-elevated p-3 text-sm" maxLength={1200} onChange={(event) => setNote(event.target.value)} placeholder="Internal officer note" value={note}/><Button disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate({ id: selected.id, body: note })} size="sm">Add internal note</Button></div></div> : <div className="flex min-h-72 flex-col items-center justify-center text-center"><ShieldAlert className="text-accent"/><h2 className="mt-4 font-bold">Select a report</h2><p className="mt-2 text-sm text-muted">Open a row to inspect and triage its safe diagnostic state.</p></div>}</Card>
    </section>
  </div>;
}

export default function ReportsPage() { return <AppShell><ReportsContent /></AppShell>; }
