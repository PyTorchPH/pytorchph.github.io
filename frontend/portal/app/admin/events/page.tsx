"use client";

import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { Badge } from "@pytorch-ph/design-system/badge";
import { SegmentedTabs, TabPanel } from "@pytorch-ph/design-system/tabs";
import { useState } from "react";
import { CompetitiveEventForm } from "./competitive-event";
import { EventList } from "./event-list";

// Officers create organization events and competition results here; external event
// submissions were removed, so this is the only way an event is added.
export default function EventWorkflowPage() {
  const [section, setSection] = useState<"all" | "workshops" | "hackathons" | "learning" | "create" | "results">("all");
  return <AppShell><div className="space-y-6">
    <section className="page-hero" data-tour="workflow-heading"><Badge variant="orange">Officers only</Badge><h1 className="mt-3 text-3xl font-extrabold">Event workflow</h1><p className="mt-3 max-w-3xl leading-7 text-muted">Create organization events and record entrants and results. Email drafts are in the Email workspace.</p></section>
    <div aria-label="Event workflow sections"><SegmentedTabs items={[{ value: "all", label: "All events" }, { value: "workshops", label: "Workshops" }, { value: "hackathons", label: "Hackathons" }, { value: "learning", label: "Learning lessons" }, { value: "create", label: "Create event" }, { value: "results", label: "Manage event results" }]} onChange={setSection} value={section} /></div>
    <TabPanel>
      {(section === "all" || section === "workshops" || section === "hackathons" || section === "learning") && <EventList category={section} />}
      {section === "create" && <CompetitiveEventForm mode="create" />}
      {section === "results" && <CompetitiveEventForm mode="results" />}
    </TabPanel>
  </div></AppShell>;
}
