"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileJson, PencilLine, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { InfoPopover } from "@pytorch-ph/design-system/info-popover";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { SegmentedTabs } from "@pytorch-ph/design-system/tabs";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import { automaticEventSource, automaticEventSources, eventCategorySchema, type EventCategory, type EventPackage, type ExternalEvent } from "@pytorch-ph/domain-protocol/organization";

type Mode = "manual" | "automatic";

const modes: Array<{ value: Mode; label: string }> = [
  { value: "manual", label: "Fill in the details" },
  { value: "automatic", label: "Use AI" },
];

const categoryLabels: Record<EventCategory, string> = {
  events: "Event or meetup",
  workshops: "Workshop",
  hackathons: "Hackathon",
  "competitive-programming": "Competition",
};

const emptyForm = { title: "", organizer: "", summary: "", category: "events" as EventCategory, startAt: "", venue: "", sourceUrl: "", registrationUrl: "", fee: "Free" };

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function manualPackage(form: typeof emptyForm): Promise<EventPackage> {
  const details = { ...form, registrationUrl: form.registrationUrl || null };
  return {
    ...details,
    scope: "external",
    startAt: new Date(form.startAt).toISOString(),
    endAt: null,
    timezone: "Asia/Manila",
    registrationDeadline: null,
    eligibility: [],
    requirements: [],
    scrapedAt: new Date().toISOString(),
    contentHash: await sha256(JSON.stringify(details)),
    scraperVersion: "manual-entry",
    confidence: 1,
    warnings: ["Entered manually by the submitter."],
  };
}

// Add an event hosted somewhere else: type the details, or let AI read a Luma or Meetup page.
export function AddExternalEvent() {
  const client = useQueryClient();
  const [mode, setMode] = useState<Mode>("manual");
  const [form, setForm] = useState(emptyForm);
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<EventPackage | null>(null);
  const [extracting, setExtracting] = useState(false);
  const source = automaticEventSource(url);
  const sourceNames = automaticEventSources.map((item) => item.name);
  const names = sourceNames.join(" and ");
  const eitherName = sourceNames.join(" or ");

  const submit = useMutation({
    mutationFn: (value: EventPackage) => fetchJson<ExternalEvent>("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
    onSuccess: async () => { setDraft(null); setUrl(""); setForm(emptyForm); await client.invalidateQueries({ queryKey: ["external-events"] }); toast.success("Event published with an unapproved label."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Submission failed."),
  });

  const extract = async () => {
    setExtracting(true);
    try {
      const companion = process.env.NEXT_PUBLIC_PYTORCH_PH_LOCAL_COMPANION_URL || "http://127.0.0.1:8000";
      const response = await fetch(`${companion}/api/org-events/extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || payload.detail || "Local extraction failed.");
      setDraft(payload);
      toast.success("AI returned event details for you to review.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Start the local companion first.");
    } finally {
      setExtracting(false);
    }
  };

  const submitManual = async (event: FormEvent) => {
    event.preventDefault();
    submit.mutate(await manualPackage(form));
  };
  const field = (key: keyof typeof emptyForm) => ({ value: form[key], onChange: (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value })) });

  return <Card className="bg-surface" data-tour="events-add">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold tracking-[-0.02em]">Add an external event</h2>
          <InfoPopover label="About adding external events" title="Which links can AI read?">
            <p>AI can retrieve details automatically from <strong>{names}</strong> event pages, because both publish their event details in a consistent format.</p>
            <p className="mt-2">Other websites are not supported yet. For those, choose <strong>Fill in the details</strong> and type them yourself.</p>
            <p className="mt-2 text-muted">Either way, the event is published as unapproved until it is reviewed.</p>
          </InfoPopover>
        </div>
        <p className="mt-1 text-sm text-muted">Share a PyTorch or machine learning event hosted by another organizer.</p>
      </div>
      <div aria-label="How to add the event" role="group"><SegmentedTabs items={modes} onChange={setMode} value={mode} /></div>
    </div>

    {mode === "manual" ? <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={submitManual}>
      <div><Label htmlFor="event-title">Event name</Label><Input className="mt-1" id="event-title" maxLength={200} minLength={3} required {...field("title")} /></div>
      <div><Label htmlFor="event-organizer">Organizer</Label><Input className="mt-1" id="event-organizer" maxLength={200} minLength={2} required {...field("organizer")} /></div>
      <div><Label htmlFor="event-category">Type</Label><select className="focus-ring mt-1 h-11 w-full border border-border bg-elevated px-3 text-sm" id="event-category" {...field("category")}>{eventCategorySchema.options.map((option) => <option key={option} value={option}>{categoryLabels[option]}</option>)}</select></div>
      <div><Label htmlFor="event-start">Starts</Label><Input className="mt-1" id="event-start" required type="datetime-local" {...field("startAt")} /></div>
      <div><Label htmlFor="event-venue">Venue or platform</Label><Input className="mt-1" id="event-venue" maxLength={300} required {...field("venue")} /></div>
      <div><Label htmlFor="event-fee">Fee</Label><Input className="mt-1" id="event-fee" maxLength={120} required {...field("fee")} /></div>
      <div><Label htmlFor="event-source">Event page link</Label><Input className="mt-1" id="event-source" placeholder="https://" required type="url" {...field("sourceUrl")} /></div>
      <div><Label htmlFor="event-registration">Registration link (optional)</Label><Input className="mt-1" id="event-registration" placeholder="https://" type="url" {...field("registrationUrl")} /></div>
      <div className="md:col-span-2"><Label htmlFor="event-summary">Summary</Label><textarea className="focus-ring mt-1 min-h-28 w-full border border-border bg-elevated p-3 text-sm" id="event-summary" maxLength={3000} minLength={10} required {...field("summary")} /></div>
      <div className="md:col-span-2"><Button disabled={submit.isPending} type="submit"><PencilLine size={16} />{submit.isPending ? "Submitting…" : "Submit event for review"}</Button></div>
    </form> : <div className="mt-5">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div><Label htmlFor="event-url">{eitherName} event link</Label><Input aria-describedby="event-url-help" className="mt-1" id="event-url" onChange={(event) => setUrl(event.target.value)} placeholder="https://lu.ma/your-event" type="url" value={url} /></div>
        <Button className="self-end" disabled={!source || extracting} onClick={extract} type="button"><ScanSearch size={17} />{extracting ? "Reading the page…" : "Retrieve details with AI"}</Button>
      </div>
      <p className="mt-2 text-sm text-muted" id="event-url-help" role="status">{!url ? `Paste a ${eitherName} link.` : source ? `${source} link recognized.` : `This link is not from ${eitherName}. Choose “Fill in the details” to add it yourself.`}</p>
      {draft && <div className="mt-4 border border-success/30 bg-success/10 p-4">
        <div className="flex items-center justify-between gap-3"><div><p className="font-bold">{draft.title}</p><p className="mt-1 text-sm text-muted">{draft.organizer} · confidence {Math.round(draft.confidence * 100)}%</p></div><Badge variant="success"><FileJson size={14} />Details retrieved</Badge></div>
        <p className="mt-3 text-sm leading-6">{draft.summary}</p>
        <div className="mt-4 flex flex-wrap gap-2"><Button disabled={submit.isPending} onClick={() => submit.mutate(draft)} size="sm" type="button">Submit event for review</Button><Button onClick={() => setDraft(null)} size="sm" type="button" variant="ghost">Discard</Button></div>
      </div>}
    </div>}
  </Card>;
}
