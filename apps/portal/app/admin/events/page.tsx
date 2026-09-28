"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { InfoPopover } from "@pytorch-ph/design-system/info-popover";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { EventAction, ExternalEvent } from "@pytorch-ph/domain-protocol/organization";
import { AddExternalEvent } from "../../events/add-external-event";
import { departmentLabel, statusLabel } from "../../events/event-labels";

const MIN_REFERENCE_LENGTH = 4;

type Stage = { key: string; title: string; help: string; events: ExternalEvent[]; empty: string };

function EventSummary({ event, children }: { event: ExternalEvent; children?: ReactNode }) {
  return <li className="border border-border bg-elevated p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{event.title}</h3><Badge variant={event.status === "sado_approved" ? "success" : "warning"}>{statusLabel[event.status]}</Badge></div>
    <p className="mt-1 text-sm text-muted">{event.organizer} · {new Date(event.startAt).toLocaleString()} · {event.venue}</p>
    <div className="mt-3 flex flex-wrap gap-1">{event.requiredDepartments.map((department) => <Badge key={department} variant={event.approvedDepartments.includes(department) ? "success" : "default"}>{departmentLabel(department)}</Badge>)}</div>
    <a className="mt-3 inline-flex items-center gap-2 text-sm text-accent underline underline-offset-2" href={event.sourceUrl} rel="noreferrer" target="_blank">Open event page <ExternalLink aria-hidden="true" size={14} /></a>
    {children && <div className="mt-4 space-y-2">{children}</div>}
  </li>;
}

// The officer workflow for an event: create it, approve it by department, review the email, record the approval.
function EventWorkflowContent() {
  const manifest = useCapabilities();
  const client = useQueryClient();
  const [deliveryReferences, setDeliveryReferences] = useState<Record<string, string>>({});
  const [approvalReferences, setApprovalReferences] = useState<Record<string, string>>({});
  const events = useQuery({ queryKey: ["external-events"], queryFn: () => fetchJson<ExternalEvent[]>("/api/events", { cache: "no-store" }) });
  const action = useMutation({
    mutationFn: ({ id, action: eventAction }: { id: string; action: EventAction }) => fetchJson<ExternalEvent>(`/api/events/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(eventAction) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["external-events"] }); toast.success("Event workflow updated."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Action failed."),
  });
  const draftText = (event: ExternalEvent) => `${event.emailDraft?.subject || ""}\n\n${event.emailDraft?.body || ""}`;
  const copyDraft = async (event: ExternalEvent) => {
    try {
      await navigator.clipboard.writeText(draftText(event));
      toast.success("Email draft copied.");
      return true;
    } catch {
      toast.error("Clipboard access failed. Select the draft and copy it manually.");
      return false;
    }
  };
  const approveEmail = async (event: ExternalEvent) => {
    if (event.emailDraft?.deliveryMode === "copy_export" && !(await copyDraft(event))) return;
    action.mutate({ id: event.id, action: { action: "approve_email" } });
  };

  const all = events.data || [];
  const stages: Stage[] = [
    { key: "approve", title: "2. Department approval", help: "Each required department approves the event. The email step opens when all of them have approved.", events: all.filter((event) => ["not_sado_approved", "department_review"].includes(event.status)), empty: "No events are waiting for department approval." },
    { key: "email", title: "3. Auto emailer", help: "The system drafts the endorsement email. Review the exact text, then approve it to send or export. Nothing is sent without your approval.", events: all.filter((event) => event.status === "email_review"), empty: "No email drafts are waiting for review." },
    { key: "final", title: "4. Final approval", help: "After the email is delivered, record the reference of the reply that approves the event.", events: all.filter((event) => event.status === "submitted_to_sado"), empty: "No events are waiting for final approval." },
    { key: "done", title: "Approved", help: "Approved events appear on the Community Events page for members.", events: all.filter((event) => event.status === "sado_approved"), empty: "No approved events yet." },
  ];

  return <div className="space-y-6">
    <section className="border border-border bg-surface p-6 lg:p-8" data-tour="workflow-heading">
      <Badge variant="orange">Officers only</Badge>
      <h1 className="mt-3 text-3xl font-extrabold">Event workflow</h1>
      <p className="mt-3 max-w-3xl leading-7 text-muted">Create an event, approve it by department, review the email before it goes out, and record the final approval. Members see an event as approved only at the end.</p>
    </section>

    <section aria-labelledby="stage-create" className="space-y-3">
      <h2 className="font-heading text-xl font-semibold" id="stage-create">1. Create an event</h2>
      <AddExternalEvent />
    </section>

    {events.isError && <Card className="bg-surface"><p className="text-sm text-muted">Events are unavailable right now.</p></Card>}

    {stages.map((stage) => <section aria-labelledby={`stage-${stage.key}`} className="space-y-3" key={stage.key}>
      <div className="flex items-center gap-2"><h2 className="font-heading text-xl font-semibold" id={`stage-${stage.key}`}>{stage.title}</h2><InfoPopover label={`About ${stage.title}`} title={stage.title}><p>{stage.help}</p></InfoPopover></div>
      <Card className="min-w-0 bg-surface">
        {stage.events.length === 0 ? <p className="text-sm text-muted">{events.isLoading ? "Loading events…" : stage.empty}</p> : <ul className="grid gap-3 lg:grid-cols-2">
          {stage.events.map((event) => <EventSummary event={event} key={event.id}>
            {stage.key === "approve" && <Button disabled={action.isPending} onClick={() => action.mutate({ id: event.id, action: { action: "approve_department" } })} size="sm" type="button">{manifest.localDemo ? "Approve as the next department" : "Approve for my department"} ({event.departmentApprovals}/{event.departmentTotal})</Button>}
            {stage.key === "email" && <>
              <div className="border border-border bg-surface p-3 text-xs"><div className="mb-2 flex items-center justify-between gap-2"><p className="font-bold">{event.emailDraft?.subject}</p><Badge>{event.emailDraft?.deliveryMode === "gmail" ? "Sends by Gmail" : "Copy and send yourself"}</Badge></div><pre className="max-h-40 overflow-auto whitespace-pre-wrap text-muted" tabIndex={0}>{event.emailDraft?.body}</pre></div>
              {event.emailDraft?.deliveryStatus !== "exported" ? <div className="flex flex-wrap gap-2"><Button onClick={() => copyDraft(event)} size="sm" type="button" variant="secondary">Copy draft</Button><Button disabled={action.isPending} onClick={() => approveEmail(event)} size="sm" type="button"><MailCheck size={14} />{event.emailDraft?.deliveryMode === "gmail" ? "Approve and send" : "Approve this exact text"}</Button></div> : <div className="space-y-2 border border-warning/30 bg-warning/10 p-3">
                <Label htmlFor={`delivery-${event.id}`}>Sent email or thread reference</Label>
                <p className="text-xs text-muted">The draft was exported. Record the reference only after you have sent it.</p>
                <Input id={`delivery-${event.id}`} onChange={(change) => setDeliveryReferences((current) => ({ ...current, [event.id]: change.target.value }))} value={deliveryReferences[event.id] || ""} />
                <Button disabled={(deliveryReferences[event.id] || "").trim().length < MIN_REFERENCE_LENGTH || action.isPending} onClick={() => action.mutate({ id: event.id, action: { action: "confirm_manual_delivery", detail: deliveryReferences[event.id] } })} size="sm" type="button">Confirm delivery</Button>
              </div>}
            </>}
            {stage.key === "final" && <div className="space-y-2">
              <Label htmlFor={`approval-${event.id}`}>Approval reference</Label>
              <Input id={`approval-${event.id}`} onChange={(change) => setApprovalReferences((current) => ({ ...current, [event.id]: change.target.value }))} placeholder="Email, thread, or reference ID" value={approvalReferences[event.id] || ""} />
              <Button disabled={(approvalReferences[event.id] || "").trim().length < MIN_REFERENCE_LENGTH || action.isPending} onClick={() => action.mutate({ id: event.id, action: { action: "record_sado_approval", detail: approvalReferences[event.id] } })} size="sm" type="button"><CheckCircle2 size={14} />Record approval</Button>
            </div>}
          </EventSummary>)}
        </ul>}
      </Card>
    </section>)}
  </div>;
}

export default function EventWorkflowPage() {
  return <AppShell><EventWorkflowContent /></AppShell>;
}
