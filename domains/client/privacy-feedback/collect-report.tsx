"use client";

import { useEffect, useRef, useState } from "react";
import { Bug, CheckCircle2, MessageSquareWarning, ShieldCheck } from "lucide-react";
import { AppDialog } from "@pytorch-ph/design-system/dialog";
import { Button } from "@pytorch-ph/design-system/button";
import { Label } from "@pytorch-ph/design-system/input";
import { Textarea } from "@pytorch-ph/design-system/textarea";
import { captureVisibleTab } from "@pytorch-ph/domain-client/client-automation";
import { compressScreenshot, installConsoleCapture, pageStateSnapshot, recentLogs, type LogEntry } from "./capture-diagnostics";

type Category = "bug" | "broken_flow" | "privacy" | "security" | "suggestion" | "automatic_error";

function redactError(value: string) {
  return value.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email redacted]").replace(/https?:\/\/\S+/g, "[url redacted]").slice(0, 300);
}

type Attachments = { logs: LogEntry[] | null; pageState: string | null; screenshot: string | null };

// Attachments go after the report exists; a failed attachment never loses the report.
async function attach(id: string, attachments: Attachments) {
  const items: Array<[string, unknown]> = [];
  if (attachments.logs?.length) items.push(["logs", attachments.logs]);
  if (attachments.pageState) items.push(["page_state", attachments.pageState]);
  if (attachments.screenshot) items.push(["screenshot", attachments.screenshot]);
  const failed: string[] = [];
  for (const [kind, data] of items) {
    const response = await fetch(`/api/feedback/${id}/attachments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, data }) }).catch(() => null);
    if (!response?.ok) failed.push(kind.replace("_", " "));
  }
  return failed;
}

function uiState(error?: string) {
  const markers = [...document.querySelectorAll<HTMLElement>("[data-tour],[data-testid]")]
    .map((node) => node.dataset.tour || node.dataset.testid || "")
    .filter(Boolean).slice(0, 40);
  return {
    title: document.title.slice(0, 160),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    online: navigator.onLine,
    componentMarkers: [...new Set(markers)],
    ...(error ? { error: redactError(error) } : {}),
  };
}

async function send(category: Category, description: string, error?: string) {
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, description, route: window.location.pathname, uiState: uiState(error) }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Report could not be sent.");
  return payload as { id: string };
}

type QueuedOperationalEvent = { payload: Record<string, unknown>; attempt: number };
const operationalQueue: QueuedOperationalEvent[] = [];
let operationalFlushActive = false;

async function flushOperationalQueue() {
  if (operationalFlushActive) return;
  operationalFlushActive = true;
  try {
    while (operationalQueue.length) {
      const current = operationalQueue[0];
      try {
        const response = await fetch("/api/operations/events", { method: "POST", headers: { "Content-Type": "application/json", "X-Operational-Event": "1" }, body: JSON.stringify(current.payload) });
        if (!response.ok) throw new Error("Operational event could not be sent.");
        operationalQueue.shift();
      } catch {
        current.attempt += 1;
        if (current.attempt >= 3) operationalQueue.shift();
        else window.setTimeout(() => void flushOperationalQueue(), 500 * (2 ** current.attempt));
        break;
      }
    }
  } finally { operationalFlushActive = false; }
}

async function sendOperational(code: string, outcome: "succeeded" | "stopped" | "failed", error?: string, detailed = false) {
  const eventId = crypto.randomUUID();
  const payload = {
    eventId,
    correlationId: crypto.randomUUID(),
    component: "portal.browser",
    stage: "runtime",
    code,
    severity: outcome === "failed" ? "error" : "info",
    outcome,
    retryable: false,
    occurredAt: new Date().toISOString(),
    route: window.location.pathname,
    ...(detailed && error ? { details: { message: redactError(error), componentMarkers: uiState().componentMarkers } } : {}),
  };
  operationalQueue.push({ payload, attempt: 0 });
  if (operationalQueue.length > 50) operationalQueue.shift();
  await flushOperationalQueue();
}

export function FeedbackReporter() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("bug");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [failure, setFailure] = useState("");
  const automaticEnabled = useRef(false);
  const sentErrors = useRef(new Set<string>());
  const [includeLogs, setIncludeLogs] = useState(true);
  const [includePage, setIncludePage] = useState(true);
  const [includeShot, setIncludeShot] = useState(true);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ logs: LogEntry[]; pageState: string } | null>(null);

  // The page and screenshot are captured before the dialog covers the page.
  async function openReporter() {
    setResult(""); setFailure(""); setScreenshot(null);
    setSnapshot({ logs: recentLogs(), pageState: pageStateSnapshot() });
    const shot = await captureVisibleTab().catch(() => null);
    setScreenshot(shot ? await compressScreenshot(shot).catch(() => null) : null);
    setOpen(true);
  }

  useEffect(() => {
    installConsoleCapture();
    fetch("/api/member/privacy").then((response) => response.ok ? response.json() : null)
      .then((value) => { automaticEnabled.current = Boolean(value?.automaticErrorReports); }).catch(() => undefined);
    const handler = (event: ErrorEvent) => {
      const fingerprint = `${event.message}:${event.filename}:${event.lineno}`;
      if (sentErrors.current.has(fingerprint)) return;
      sentErrors.current.add(fingerprint);
      sendOperational("window_error", "failed", event.message, automaticEnabled.current).catch(() => undefined);
    };
    const rejectionHandler = (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error ? event.reason.message : "Unhandled promise rejection";
      const fingerprint = `promise:${message}`;
      if (sentErrors.current.has(fingerprint)) return;
      sentErrors.current.add(fingerprint);
      sendOperational("unhandled_rejection", "failed", message, automaticEnabled.current).catch(() => undefined);
    };
    const operationalHandler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || typeof detail.code !== "string" || !["succeeded", "stopped", "failed"].includes(detail.outcome)) return;
      sendOperational(detail.code, detail.outcome, undefined, false).catch(() => undefined);
    };
    window.addEventListener("error", handler);
    window.addEventListener("unhandledrejection", rejectionHandler);
    window.addEventListener("PYTORCH_PH_OPERATIONAL_EVENT", operationalHandler);
    return () => { window.removeEventListener("error", handler); window.removeEventListener("unhandledrejection", rejectionHandler); window.removeEventListener("PYTORCH_PH_OPERATIONAL_EVENT", operationalHandler); };
  }, []);

  return <>
    <Button className="fixed bottom-4 right-4 z-50 gap-2 shadow-xl" onClick={() => { void openReporter(); }} type="button" variant="secondary">
      <MessageSquareWarning size={17} /> Report
    </Button>
    {open && <AppDialog description="Describe what happened. Choose which diagnostics to include below." onClose={() => setOpen(false)} title="Report a problem or suggestion">
      {result ? <div className="rounded-xl border border-success/30 bg-success/10 p-5 text-center"><CheckCircle2 className="mx-auto text-success" /><p className="mt-3 font-semibold">Report received</p><p className="mt-1 text-sm text-muted">Reference {result}</p></div> : <div className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-3">{(["bug","broken_flow","privacy","security","suggestion"] as Category[]).map((value) => <button className={`rounded-lg border p-3 text-left text-sm ${category === value ? "border-accent bg-accentSoft text-accent" : "border-border"}`} key={value} onClick={() => setCategory(value)} type="button">{value.replaceAll("_", " ")}</button>)}</div>
        <div><Label htmlFor="report-description">Optional note</Label><Textarea id="report-description" maxLength={1200} onChange={(event) => setDescription(event.target.value)} placeholder="What were you trying to do?" value={description} /></div>
        <fieldset className="space-y-2 rounded-lg border border-border bg-elevated p-3 text-sm"><legend className="px-1 text-xs font-semibold text-muted">Attach diagnostics</legend>
          <label className="flex gap-2"><input checked={includeLogs} className="mt-1 accent-accent" onChange={(event) => setIncludeLogs(event.target.checked)} type="checkbox" /><span>Recent console errors and warnings <span className="text-muted">({snapshot?.logs.length ?? 0})</span></span></label>
          <label className="flex gap-2"><input checked={includePage} className="mt-1 accent-accent" onChange={(event) => setIncludePage(event.target.checked)} type="checkbox" /><span>Page state: the visible page without scripts or form values</span></label>
          {screenshot ? <label className="flex gap-2"><input checked={includeShot} className="mt-1 accent-accent" onChange={(event) => setIncludeShot(event.target.checked)} type="checkbox" /><span>Screenshot from the PyTorch PH extension<img alt="Screenshot preview" className="mt-2 max-h-40 border border-border" src={screenshot} /></span></label> : <p className="text-xs text-muted">Install the PyTorch PH extension to attach a screenshot.</p>}
          <p className="flex gap-2 text-xs leading-5 text-muted"><ShieldCheck className="flex-none text-success" size={15} />Always sent: route, page title, viewport and component identifiers. Emails, links and tokens are redacted; cookies, form values and local cache are never sent. Only officers and you can open these attachments.</p>
        </fieldset>
        {failure && <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">{failure}</p>}
        <Button className="w-full gap-2" disabled={busy} onClick={async () => { setBusy(true); setFailure(""); try { const value = await send(category, description); const failed = await attach(value.id, { logs: includeLogs ? snapshot?.logs ?? null : null, pageState: includePage ? snapshot?.pageState ?? null : null, screenshot: includeShot ? screenshot : null }); setResult(value.id.slice(0, 8).toUpperCase()); if (failed.length) setFailure(`Report received, but these attachments failed: ${failed.join(", ")}.`); } catch (error) { setFailure(error instanceof Error ? error.message : "Report failed"); } finally { setBusy(false); } }} type="button"><Bug size={16} />{busy ? "Sending…" : "Send report"}</Button>
      </div>}
    </AppDialog>}
  </>;
}
