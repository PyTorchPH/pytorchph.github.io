"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarDays, Crown, ExternalLink, Users } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { FilipinoPhrase } from "@pytorch-ph/design-system/filipino-phrase";
import { fetchJson, queryKeys } from "@pytorch-ph/domain-client/transport";
import type { ExternalEvent } from "@pytorch-ph/domain-protocol/organization";
import { hasPriorityEnrollment } from "@pytorch-ph/domain-protocol/identity";
import type { ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import { AddExternalEvent } from "./add-external-event";
import { departmentLabel, statusLabel } from "./event-labels";

// The same page for members and officers. Officers run approvals in Event Workflow.
function EventsContent() {
  const manifest = useCapabilities();
  const client = useQueryClient();
  const externalEvents = useQuery({ queryKey: ["external-events"], queryFn: () => fetchJson<ExternalEvent[]>("/api/events", { cache: "no-store" }) });
  const chapterDashboard = useQuery({ queryKey: queryKeys.product("dashboard"), queryFn: () => fetchJson<ProductViewData>("/api/product/dashboard", { cache: "no-store" }) });
  const interest = useMutation({
    mutationFn: (id: string) => fetchJson<ExternalEvent>(`/api/events/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "interest" }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["external-events"] }); toast.success("Interest recorded."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Action failed."),
  });
  const toggleRegistration = useMutation({
    mutationFn: (id: string) => fetchJson("/api/product/demo-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "toggle_event", id }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: queryKeys.product("dashboard") }); toast.success("Synthetic event registration updated."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Event update failed."),
  });

  const dashboard = chapterDashboard.data || null;
  const effectiveTier = manifest.portal.userTier;
  const priority = hasPriorityEnrollment(effectiveTier);
  const chapterEvents = dashboard?.events || [];

  return <div className="space-y-8">
    <section className="page-hero">
      <FilipinoPhrase meaning="Come, join us!" phrase="Tara, sali na!" /><h1 className="mt-1 text-3xl font-extrabold">Community events</h1>
      <p className="mt-3 max-w-3xl leading-7 text-muted">Workshops, hackathons, study groups, and meetups. You can also share an event hosted by another organizer at the bottom of this page.</p>
    </section>

    <section className="space-y-4" data-tour="events-heading">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold tracking-[-0.02em]">Upcoming events</h2><p className="mt-2 text-muted">Register for workshops, clinics, hackathons, and other community activities.</p></div><div data-tour="events-role"><Badge variant="orange">{effectiveTier === "general" ? "Member access" : "Priority member"}</Badge></div></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-tour="events-grid">
        {chapterEvents.map((event) => <Card className="flex flex-col bg-surface" key={event.id}>
          <div className="mb-4 flex items-start justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accentSoft text-accent"><CalendarDays size={20}/></div>{priority ? <Badge variant="orange"><Crown size={14}/>Priority seat</Badge> : effectiveTier === "active" ? <Badge variant="success"><Bell size={14}/>Early access</Badge> : <Badge>Standard queue</Badge>}</div>
          <h3 className="text-lg font-bold tracking-[-0.02em]">{event.title}</h3><p className="mt-3 text-sm leading-6 text-muted">{event.department}</p>
          <div className="mt-4 space-y-3 rounded-lg border border-border bg-elevated p-3 text-xs leading-5"><p><strong>Learning objective:</strong> {event.learningObjective}</p><p><strong>Expected output:</strong> {event.output}</p></div>
          <div className="mt-5 flex items-center justify-between border-t border-border pt-4"><div><p className="data-label text-sm">{event.date}</p><p className="text-xs text-muted">{event.type}</p></div><div className="flex items-center gap-2 text-sm text-muted"><Users size={16}/>{event.seats}</div></div>
          {dashboard?.meta.mode === "local_demo" && <Button className="mt-4 w-full" disabled={toggleRegistration.isPending} onClick={() => toggleRegistration.mutate(event.id)} size="sm" variant={event.registered ? "secondary" : "primary"}>{event.registered ? "Leave synthetic event" : "Join synthetic event"}</Button>}
        </Card>)}
      </div>
    </section>

    {Boolean(externalEvents.data?.length) && <section aria-labelledby="external-events-heading" className="space-y-4">
      <h2 className="text-2xl font-bold tracking-[-0.02em]" id="external-events-heading">External events</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {externalEvents.data?.map((event) => <Card className="flex flex-col bg-surface" key={event.id}>
          <div className="flex items-start justify-between gap-3"><CalendarDays aria-hidden="true" className="text-accent" /><Badge variant={event.status === "sado_approved" ? "success" : "warning"}>{statusLabel[event.status]}</Badge></div>
          <h3 className="mt-4 text-lg font-bold">{event.title}</h3><p className="mt-1 text-sm text-muted">{event.organizer}</p><p className="mt-3 line-clamp-3 text-sm leading-6">{event.summary}</p>
          <div className="mt-4 border border-border bg-elevated p-3 text-xs leading-5"><p>{new Date(event.startAt).toLocaleString()} · {event.timezone}</p><p>{event.venue}</p><p className="mt-2 flex items-center gap-2"><Users aria-hidden="true" size={14} />{event.interestCount} interested</p></div>
          <div className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Required approvals</p><div className="mt-2 flex flex-wrap gap-1">{event.requiredDepartments.map((department) => <Badge key={department} variant={event.approvedDepartments.includes(department) ? "success" : "default"}>{departmentLabel(department)}</Badge>)}</div></div>
          <a className="mt-3 flex items-center gap-2 text-sm text-accent underline underline-offset-2" href={event.sourceUrl} rel="noreferrer" target="_blank">Open event page <ExternalLink aria-hidden="true" size={14} /></a>
          {event.status !== "sado_approved" && <Button className="mt-auto w-full" disabled={event.interested || interest.isPending} onClick={() => interest.mutate(event.id)} size="sm" type="button" variant="secondary">{event.interested ? "Interest recorded" : "I’m interested"}</Button>}
        </Card>)}
      </div>
    </section>}

    <AddExternalEvent />
  </div>;
}

export default function EventsPage() {
  return <AppShell><EventsContent /></AppShell>;
}
