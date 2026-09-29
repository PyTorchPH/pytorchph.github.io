"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarDays, Code2, Crown, GraduationCap, Mic, Trophy, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { AppDialog } from "@pytorch-ph/design-system/dialog";
import { FilipinoPhrase } from "@pytorch-ph/design-system/filipino-phrase";
import { fetchJson, queryKeys } from "@pytorch-ph/domain-client/transport";
import { hasPriorityEnrollment } from "@pytorch-ph/domain-protocol/identity";
import type { ChapterEvent, ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN || "").replace(/\/$/, "");
type OfficialEvent = { id: string; title: string; category: string; startsAt: string; parentId: string | null; publishedAt: string | null };

// One card model for organization events (API) and chapter programme events.
type UpcomingEvent = {
  id: string;
  title: string;
  kind: string;
  when: string;
  sortKey: number;
  chapter?: ChapterEvent;
  resultsPublished?: boolean;
};

const COVERS: Array<{ match: RegExp; icon: LucideIcon; tone: string }> = [
  { match: /hackathon|competitive|contest/i, icon: Trophy, tone: "from-amber-500/80 to-orange-700/90" },
  { match: /workshop|clinic|lab/i, icon: Code2, tone: "from-sky-500/80 to-indigo-700/90" },
  { match: /talk|meetup|summit/i, icon: Mic, tone: "from-fuchsia-500/80 to-purple-700/90" },
  { match: /orientation|study|learning/i, icon: GraduationCap, tone: "from-emerald-500/80 to-teal-700/90" },
];
// Tabs group the organization categories (talk, workshop, hackathon, competitive, mini contest)
// and the chapter programme types (orientation, clinic, study group, ...).
const EVENT_TABS: Array<{ id: string; label: string; match: RegExp }> = [
  { id: "talks", label: "Talks", match: /talk|meetup|summit|webinar|forum/i },
  { id: "workshops", label: "Workshops", match: /workshop|clinic|lab/i },
  { id: "hackathons", label: "Hackathons", match: /hackathon/i },
  { id: "competitions", label: "Competitions", match: /competitive|contest|competition/i },
  { id: "learning", label: "Learning sessions", match: /orientation|study|learning|bootcamp|course/i },
];
const tabOf = (kind: string) => EVENT_TABS.find((tab) => tab.match.test(kind))?.id ?? "other";

const coverFor = (kind: string) => COVERS.find((cover) => cover.match.test(kind)) ?? { icon: CalendarDays, tone: "from-accent/80 to-slate-800/90" };

function EventCover({ event, large = false }: { event: UpcomingEvent; large?: boolean }) {
  const { icon: Icon, tone } = coverFor(event.kind);
  return <div aria-hidden="true" className={`relative flex items-end overflow-hidden bg-gradient-to-br ${tone} ${large ? "h-48" : "aspect-[16/10]"}`} style={{ backgroundImage: "var(--hero-art)", backgroundSize: "cover", backgroundBlendMode: "overlay" }}>
    <Icon className="absolute right-4 top-4 text-white/80" size={large ? 44 : 32} />
    <span className="m-3 bg-black/40 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-white">{event.kind.replaceAll("_", " ")}</span>
  </div>;
}

function useUpcomingEvents() {
  const chapter = useQuery({ queryKey: queryKeys.product("dashboard"), queryFn: () => fetchJson<ProductViewData>("/api/product/dashboard", { cache: "no-store" }) });
  const official = useQuery({
    queryKey: ["official-events", API_ORIGIN],
    enabled: Boolean(API_ORIGIN),
    queryFn: async () => {
      const response = await fetch(`${API_ORIGIN}/public/events`, { cache: "no-store" });
      if (!response.ok) throw new Error("Events are unavailable.");
      return response.json() as Promise<OfficialEvent[]>;
    },
  });
  const events = useMemo(() => {
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const organization: UpcomingEvent[] = (official.data ?? [])
      .filter((event) => new Date(event.startsAt).getTime() >= startOfToday)
      .map((event) => ({ id: `org-${event.id}`, title: event.title, kind: event.category, when: new Date(event.startsAt).toLocaleString(), sortKey: new Date(event.startsAt).getTime(), resultsPublished: Boolean(event.publishedAt) }));
    const programme: UpcomingEvent[] = (chapter.data?.events ?? []).map((event) => ({ id: event.id, title: event.title, kind: event.type, when: event.date, sortKey: Date.parse(event.date) || Number.MAX_SAFE_INTEGER, chapter: event }));
    return [...organization, ...programme].sort((a, b) => a.sortKey - b.sortKey);
  }, [chapter.data, official.data]);
  return { events, dashboard: chapter.data ?? null, loading: chapter.isLoading || official.isLoading, failed: chapter.isError && official.isError };
}

function EventDetails({ event, onClose, priorityLabel, onToggle, toggling }: { event: UpcomingEvent; onClose: () => void; priorityLabel: string; onToggle?: () => void; toggling: boolean }) {
  const chapter = event.chapter;
  return <AppDialog description={event.when} onClose={onClose} title={event.title}>
    <EventCover event={event} large />
    <div className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap gap-2"><Badge>{event.kind.replaceAll("_", " ")}</Badge><Badge variant="orange">{priorityLabel}</Badge>{event.resultsPublished && <Badge variant="success">Official results published</Badge>}</div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">When</dt><dd className="font-semibold">{event.when}</dd></div>
        {chapter && <div><dt className="text-muted">Hosted by</dt><dd className="font-semibold">{chapter.department}</dd></div>}
        {chapter && <div><dt className="text-muted">Seats</dt><dd className="flex items-center gap-2 font-semibold"><Users aria-hidden="true" size={15} />{chapter.seats}</dd></div>}
      </dl>
      {chapter && <div className="space-y-2 border border-border bg-elevated p-3 text-sm leading-6"><p><strong>Learning objective:</strong> {chapter.learningObjective}</p><p><strong>Expected output:</strong> {chapter.output}</p></div>}
      {onToggle && chapter && <Button className="w-full" disabled={toggling} onClick={onToggle} type="button" variant={chapter.registered ? "secondary" : "primary"}>{chapter.registered ? "Leave event" : "Join event"}</Button>}
    </div>
  </AppDialog>;
}

// Upcoming events only: organization events and chapter programmes. Members and officers
// cannot add external events.
function EventsContent() {
  const manifest = useCapabilities();
  const client = useQueryClient();
  const { events, dashboard, loading, failed } = useUpcomingEvents();
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState("all");
  const toggleRegistration = useMutation({
    mutationFn: (id: string) => fetchJson("/api/product/demo-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "toggle_event", id }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: queryKeys.product("dashboard") }); toast.success("Registration updated."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Event update failed."),
  });
  const tier = manifest.portal.userTier;
  const priorityLabel = hasPriorityEnrollment(tier) ? "Priority seat" : tier === "active" ? "Early access" : "Standard queue";
  const PriorityIcon = hasPriorityEnrollment(tier) ? Crown : Bell;
  const open = events.find((event) => event.id === openId) ?? null;
  const tabs = [{ id: "all", label: "All events", count: events.length }, ...[...EVENT_TABS, { id: "other", label: "Other" }].map((item) => ({ id: item.id, label: item.label, count: events.filter((event) => tabOf(event.kind) === item.id).length })).filter((item) => item.count > 0)];
  const shown = tab === "all" ? events : events.filter((event) => tabOf(event.kind) === tab);

  return <div className="space-y-8">
    <section className="page-hero" data-tour="events-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><FilipinoPhrase meaning="Come, join us!" phrase="Tara, sali na!" /><h1 className="mt-1 text-3xl font-extrabold">Upcoming events</h1><p className="mt-3 max-w-3xl leading-7 text-muted">Workshops, hackathons, study groups and meetups. Open an event to see its full details.</p></div>
        <div data-tour="events-role"><Badge variant="orange"><PriorityIcon aria-hidden="true" size={14} />{tier === "general" ? "Member access" : priorityLabel}</Badge></div>
      </div>
    </section>

    <div aria-label="Event types" className="flex flex-wrap gap-2" role="tablist">{tabs.map((item) => <button aria-selected={tab === item.id} className={`focus-ring border px-4 py-2 text-sm font-semibold ${tab === item.id ? "border-accent bg-accentSoft text-accent" : "border-border text-muted hover:text-ink"}`} key={item.id} onClick={() => setTab(item.id)} role="tab" type="button">{item.label} <span className="ml-1 font-mono text-xs">{item.count}</span></button>)}</div>

    {failed ? <p className="text-sm text-muted" role="alert">Events are unavailable right now.</p> : <section aria-label="Upcoming events" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-tour="events-grid" role="tabpanel">
      {shown.map((event) => <button className="focus-ring group overflow-hidden border border-border bg-surface text-left transition-colors hover:border-accent" key={event.id} onClick={() => setOpenId(event.id)} type="button">
        <EventCover event={event} />
        <h2 className="p-4 text-base font-bold leading-snug tracking-[-0.01em] group-hover:text-accent">{event.title}</h2>
      </button>)}
      {!shown.length && <p className="text-sm text-muted">{loading ? "Loading events…" : "No upcoming events of this type yet."}</p>}
    </section>}

    {open && <EventDetails event={open} onClose={() => setOpenId(null)} onToggle={dashboard?.meta.mode === "local_demo" && open.chapter ? () => toggleRegistration.mutate(open.chapter!.id) : undefined} priorityLabel={priorityLabel} toggling={toggleRegistration.isPending} />}
  </div>;
}

export default function EventsPage() {
  return <AppShell><EventsContent /></AppShell>;
}
