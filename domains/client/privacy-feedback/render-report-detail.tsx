"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Code2, ScrollText } from "lucide-react";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { FeedbackReport, ReportAttachment } from "@pytorch-ph/domain-protocol/privacy-feedback";

function LogList({ entries }: { entries: Array<{ level: string; message: string; at: string }> }) {
  if (!entries.length) return <p className="text-xs text-muted">No console messages were captured.</p>;
  return <ol className="max-h-64 space-y-1 overflow-auto border border-border bg-canvas p-2 font-mono text-xs">{entries.map((entry, index) => <li className={entry.level === "error" ? "text-danger" : entry.level === "warn" ? "text-warning" : "text-muted"} key={`${entry.at}-${index}`}><span className="text-muted">{new Date(entry.at).toLocaleTimeString()} </span>[{entry.level}] {entry.message}</li>)}</ol>;
}

// The snapshot is untrusted HTML, so it renders in a sandbox with scripts and same-origin disabled.
function PageState({ html }: { html: string }) {
  const [source, setSource] = useState(false);
  return <div className="space-y-2">
    <Button onClick={() => setSource((value) => !value)} size="sm" type="button" variant="ghost">{source ? "Show rendered page" : "Show HTML source"}</Button>
    {source ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap border border-border bg-canvas p-2 text-xs">{html}</pre> : <iframe className="h-80 w-full border border-border bg-white" referrerPolicy="no-referrer" sandbox="" srcDoc={html} title="Reported page state" />}
  </div>;
}

/** What was captured with a report: UI state, officer notes, and any attachments. */
export function ReportDiagnostics({ report }: { report: FeedbackReport }) {
  const kinds = report.attachments ?? [];
  const attachments = useQuery({
    queryKey: ["feedback-attachments", report.id],
    enabled: kinds.length > 0,
    queryFn: () => fetchJson<ReportAttachment[]>(`/api/feedback/${report.id}/attachments`, { cache: "no-store" }),
  });
  const find = (kind: ReportAttachment["kind"]) => attachments.data?.find((item) => item.kind === kind);
  const logs = find("logs");
  const page = find("page_state");
  const shot = find("screenshot");
  return <div className="space-y-4 text-sm">
    <dl className="grid grid-cols-2 gap-2">
      <div><dt className="text-muted">Page title</dt><dd>{report.uiState.title || "—"}</dd></div>
      <div><dt className="text-muted">Viewport</dt><dd>{report.uiState.viewport} · {report.uiState.online ? "online" : "offline"}</dd></div>
      {report.uiState.error && <div className="col-span-2"><dt className="text-muted">Error</dt><dd className="font-mono text-xs text-danger">{report.uiState.error}</dd></div>}
      {report.uiState.componentMarkers.length > 0 && <div className="col-span-2"><dt className="text-muted">Components on screen</dt><dd className="mt-1 flex flex-wrap gap-1">{report.uiState.componentMarkers.map((marker) => <Badge key={marker}>{marker}</Badge>)}</dd></div>}
    </dl>
    {kinds.length > 0 && attachments.isLoading && <p className="text-xs text-muted">Loading attachments…</p>}
    {attachments.isError && <p className="text-xs text-warning">Attachments could not be loaded.</p>}
    {shot && <section><h3 className="mb-2 flex items-center gap-2 font-semibold"><Camera size={15} /> Screenshot</h3><a href={String(shot.content)} rel="noreferrer" target="_blank"><img alt="Reported screen" className="max-h-80 border border-border" src={String(shot.content)} /></a></section>}
    {logs && <section><h3 className="mb-2 flex items-center gap-2 font-semibold"><ScrollText size={15} /> Console logs</h3><LogList entries={Array.isArray(logs.content) ? logs.content : []} /></section>}
    {page && <section><h3 className="mb-2 flex items-center gap-2 font-semibold"><Code2 size={15} /> Page state</h3><PageState html={String(page.content)} /></section>}
    {report.notes && report.notes.length > 0 && <section><h3 className="mb-2 font-semibold">Officer notes</h3><ul className="space-y-2">{report.notes.map((note) => <li className="border border-border bg-elevated p-2" key={note.id}><p>{note.body}</p><p className="mt-1 text-xs text-muted">{new Date(note.createdAt).toLocaleString()}</p></li>)}</ul></section>}
  </div>;
}
