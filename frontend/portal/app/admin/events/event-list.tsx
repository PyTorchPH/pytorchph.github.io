"use client";

// Every organization event, with Delete where the server allows it (the President, an admin, or
// the officer who created the event), and the deletion records this officer may see.
// Module map (caller-first):
//   EventList          loads GET /api/officer/events; one row per event
//   ├─ DeleteButton    confirms, then DELETE /api/officer/events/{id} (points are revoked too)
//   └─ DeletionLog     what was removed, by whom, and how many points were taken back

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { DataUnavailable } from "@pytorch-ph/design-system/data-unavailable";
import { fetchJson } from "@pytorch-ph/domain-client/transport";

type EventRow = { id: string; title: string; category: string; startsAt: string; createdBy: string; canDelete: boolean };
type Deletion = { title: string; category: string; startsAt: string; deletedBy: string; pointsRevoked: number; membersAffected: number; deletedAt: string };
type EventListView = { events: EventRow[]; deletions: Deletion[] };

const EVENTS_KEY = ["officer-events"] as const;
const dateLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function EventList() {
  const view = useQuery({ queryKey: EVENTS_KEY, queryFn: () => fetchJson<EventListView>("/api/officer/events", { cache: "no-store" }) });
  const events = view.data?.events ?? [];
  return <>
    <Card className="bg-surface">
      <CardHeader><div><CardTitle>Events</CardTitle><CardDescription>Deleting an event also removes its entrants, results, attendance, and the points it awarded. A record of the deletion is kept.</CardDescription></div></CardHeader>
      <DataUnavailable label={view.isError ? "Data unavailable" : "Loading data"} unavailable={!view.data}>
        {events.length ? <ul className="divide-y divide-border">
          {events.map((event) => <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={event.id}>
            <div>
              <p className="font-semibold">{event.title}</p>
              <p className="text-xs text-muted">{dateLabel(event.startsAt)} · created by {event.createdBy}</p>
            </div>
            <div className="flex items-center gap-2"><Badge>{event.category.replaceAll("_", " ")}</Badge>{event.canDelete && <DeleteButton event={event} />}</div>
          </li>)}
        </ul> : <p className="py-6 text-center text-sm text-muted">No events yet.</p>}
      </DataUnavailable>
    </Card>
    {(view.data?.deletions.length ?? 0) > 0 && <DeletionLog deletions={view.data?.deletions ?? []} />}
  </>;
}

function DeleteButton({ event }: { event: EventRow }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => fetchJson<{ pointsRevoked: number; membersAffected: number }>(`/api/officer/events/${encodeURIComponent(event.id)}`, { method: "DELETE" }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: EVENTS_KEY });
      toast.success(`Deleted "${event.title}". ${result.pointsRevoked} points were taken back from ${result.membersAffected} members.`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The event was not deleted."),
  });
  const confirmDelete = () => confirm(`Delete "${event.title}" permanently? Its entrants, results, attendance, and awarded points are removed. This cannot be undone.`) && remove.mutate();
  return <Button disabled={remove.isPending} onClick={confirmDelete} size="sm" variant="secondary">{remove.isPending ? "Deleting…" : "Delete"}</Button>;
}

function DeletionLog({ deletions }: { deletions: Deletion[] }) {
  return <Card className="bg-surface">
    <CardHeader><div><CardTitle>Deleted events</CardTitle><CardDescription>Records of events you created or deleted (admins see all).</CardDescription></div></CardHeader>
    <ul className="divide-y divide-border text-sm">
      {deletions.map((entry) => <li className="py-2" key={`${entry.deletedAt}-${entry.title}`}>
        <span className="font-semibold">{entry.title}</span> ({dateLabel(entry.startsAt)}) — deleted by {entry.deletedBy} on {dateLabel(entry.deletedAt)}; {entry.pointsRevoked} points taken back from {entry.membersAffected} members.
      </li>)}
    </ul>
  </Card>;
}
