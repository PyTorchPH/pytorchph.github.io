"use client";

import { useEffect, useRef, useState } from "react";
import { Bug, CheckCircle2, MessageSquareWarning, ShieldCheck } from "lucide-react";
import { AppDialog } from "@pytorch-ph/design-system/dialog";
import { Button } from "@pytorch-ph/design-system/button";
import { Label } from "@pytorch-ph/design-system/input";
import { Textarea } from "@pytorch-ph/design-system/textarea";

type Category = "bug" | "broken_flow" | "privacy" | "security" | "suggestion" | "automatic_error";

function redactError(value: string) {
  return value.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email redacted]").replace(/https?:\/\/\S+/g, "[url redacted]").slice(0, 300);
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

  useEffect(() => {
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
    <Button className="fixed bottom-4 right-4 z-50 gap-2 shadow-xl" onClick={() => { setOpen(true); setResult(""); setFailure(""); }} type="button" variant="secondary">
      <MessageSquareWarning size={17} /> Report
    </Button>
    {open && <AppDialog description="One click sends a privacy-safe UI diagnostic. Add a note only when useful." onClose={() => setOpen(false)} title="Report a problem or suggestion">
      {result ? <div className="rounded-xl border border-success/30 bg-success/10 p-5 text-center"><CheckCircle2 className="mx-auto text-success" /><p className="mt-3 font-semibold">Report received</p><p className="mt-1 text-sm text-muted">Reference {result}</p></div> : <div className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-3">{(["bug","broken_flow","privacy","security","suggestion"] as Category[]).map((value) => <button className={`rounded-lg border p-3 text-left text-sm ${category === value ? "border-accent bg-accentSoft text-accent" : "border-border"}`} key={value} onClick={() => setCategory(value)} type="button">{value.replaceAll("_", " ")}</button>)}</div>
        <div><Label htmlFor="report-description">Optional note</Label><Textarea id="report-description" maxLength={1200} onChange={(event) => setDescription(event.target.value)} placeholder="What were you trying to do?" value={description} /></div>
        <div className="rounded-lg border border-border bg-elevated p-3 text-xs leading-5 text-muted"><ShieldCheck className="mb-2 text-success" size={17} />Sent: route, page title, viewport, online state, and component identifiers. Never sent: cookies, tokens, form values, raw HTML, account email, screenshot, or local cache contents.</div>
        {failure && <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">{failure}</p>}
        <Button className="w-full gap-2" disabled={busy} onClick={async () => { setBusy(true); setFailure(""); try { const value = await send(category, description); setResult(value.id.slice(0, 8).toUpperCase()); } catch (error) { setFailure(error instanceof Error ? error.message : "Report failed"); } finally { setBusy(false); } }} type="button"><Bug size={16} />{busy ? "Sending…" : "Send report"}</Button>
      </div>}
    </AppDialog>}
  </>;
}
