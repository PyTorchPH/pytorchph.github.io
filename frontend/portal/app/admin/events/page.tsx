"use client";

import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { Badge } from "@pytorch-ph/design-system/badge";
import { CompetitiveEventForm } from "./competitive-event";
import { EventList } from "./event-list";
import { MailWorkflow } from "./mail-workflow";

// Officers create organization events and competition results here; external event
// submissions were removed, so this is the only way an event is added.
export default function EventWorkflowPage() {
  return <AppShell><div className="space-y-6">
    <section className="page-hero" data-tour="workflow-heading"><Badge variant="orange">Officers only</Badge><h1 className="mt-3 text-3xl font-extrabold">Event workflow</h1><p className="mt-3 max-w-3xl leading-7 text-muted">Create organization events, record entrants and results, and prepare mail drafts. Everything is saved to the organization API.</p></section>
    <EventList />
    <CompetitiveEventForm />
    <MailWorkflow />
  </div></AppShell>;
}
