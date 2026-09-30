"use client";

// The Organization page: the org chart as a tree, with Assign / Remove on the positions directly
// under the viewer's own, Resign on the viewer's own seat, and the change history.
// Module map (caller-first):
//   OrganizationView      loads the chart; renders the tree from the head down and the history
//   ├─ PositionNode       one position: holders, actions, then its direct reports (recursive)
//   │   └─ HolderChip     a holder, with Remove (parent holder) or Resign (the holder themself)
//   ├─ AssignDialog       member search → assign to the chosen position
//   └─ ChangeHistory      assigned / removed / resigned entries the viewer may see
//   useChartMutation      runs a change, refreshes the chart, and toasts the outcome

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { Combobox } from "@pytorch-ph/design-system/combobox";
import { AppDialog } from "@pytorch-ph/design-system/dialog";
import { DataUnavailable } from "@pytorch-ph/design-system/data-unavailable";
import {
  ORG_CHART_QUERY_KEY, assignPosition, fetchOrgChart, removeHolder, resignPosition, searchAssignable,
  type OrgHistoryEntry, type OrgPosition,
} from "./api";

// Mental model: the server decides every permission ("canManage"); the page only shows the
// actions it will accept, so a refused request means the chart changed underneath the viewer.
export function OrganizationView() {
  const chart = useQuery({ queryKey: ORG_CHART_QUERY_KEY, queryFn: fetchOrgChart });
  const [assigning, setAssigning] = useState<OrgPosition | null>(null);
  const positions = chart.data?.positions ?? [];
  const head = positions.find((position) => position.parent === null);
  return <div className="space-y-6">
    <section className="page-hero">
      <h1 className="text-3xl font-extrabold tracking-[-0.02em]">Organization</h1>
      <p className="mt-3 max-w-3xl leading-7 text-muted">Each position is filled by the holder of the position directly above it. You can assign and remove people only in the positions right under yours, and resign from your own.</p>
    </section>
    <DataUnavailable label={chart.isError ? "Data unavailable" : "Loading data"} unavailable={!chart.data}>
      <Card className="bg-surface">
        {head ? <ul className="space-y-3"><PositionNode onAssign={setAssigning} position={head} positions={positions} /></ul> : <p className="text-sm text-muted">The chart has no head position.</p>}
      </Card>
    </DataUnavailable>
    <ChangeHistory entries={chart.data?.history ?? []} positions={positions} />
    {assigning && <AssignDialog onClose={() => setAssigning(null)} position={assigning} />}
  </div>;
}

type NodeProps = { position: OrgPosition; positions: OrgPosition[]; onAssign: (position: OrgPosition) => void };

function PositionNode({ position, positions, onAssign }: NodeProps) {
  const reports = positions.filter((candidate) => candidate.parent === position.slug);
  const seatOpen = position.seats === "many" || position.holders.length === 0;
  return <li>
    <div className={`border p-3 ${position.heldByViewer ? "border-accent bg-accentSoft" : "border-border bg-elevated"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{position.title}</p>
          <p className="text-xs text-muted">{position.departmentName}{position.seats === "many" ? " · shared position" : ""}</p>
        </div>
        {position.canManage && seatOpen && <Button onClick={() => onAssign(position)} size="sm" variant="secondary">Assign</Button>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {position.holders.length ? position.holders.map((holder) => <HolderChip holder={holder} key={holder.id} position={position} />) : <Badge variant="warning">Vacant</Badge>}
      </div>
    </div>
    {reports.length > 0 && <ul className="ml-4 mt-3 space-y-3 border-l border-border pl-4">
      {reports.map((report) => <PositionNode key={report.slug} onAssign={onAssign} position={report} positions={positions} />)}
    </ul>}
  </li>;
}

function HolderChip({ holder, position }: { holder: { id: string; name: string; handle: string }; position: OrgPosition }) {
  const remove = useChartMutation(() => removeHolder(position.slug, holder.id), `${holder.name} was removed from ${position.title}.`);
  const resign = useChartMutation(() => resignPosition(position.slug), `You resigned from ${position.title}.`);
  const isViewer = position.heldByViewer && position.holders.length === 1;
  return <span className="inline-flex items-center gap-2 border border-border bg-surface px-2 py-1 text-sm">
    {holder.name} <span className="text-xs text-muted">@{holder.handle}</span>
    {position.canManage && <button className="text-xs font-semibold text-accent underline" disabled={remove.isPending} onClick={() => confirm(`Remove ${holder.name} from ${position.title}?`) && remove.mutate()} type="button">Remove</button>}
    {isViewer && <button className="text-xs font-semibold text-accent underline" disabled={resign.isPending} onClick={() => confirm(`Resign from ${position.title}? Only the position above can assign you again.`) && resign.mutate()} type="button">Resign</button>}
  </span>;
}

function AssignDialog({ position, onClose }: { position: OrgPosition; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [memberId, setMemberId] = useState("");
  const members = useQuery({ queryKey: ["officer-organization", "members", query.trim()], queryFn: () => searchAssignable(query), enabled: query.trim().length >= 2 });
  const assign = useChartMutation(() => assignPosition(memberId, position.slug), `Assigned to ${position.title}.`, onClose);
  const options = (members.data ?? []).map((member) => ({ value: member.id, label: member.name, detail: `@${member.handle} · ${member.email}` }));
  return <AppDialog description="Search members by name, username, or email. They become an officer with this position." onClose={onClose} title={`Assign ${position.title}`}>
    <div className="space-y-4">
      <Combobox id="assign-member" label="Search members" loading={members.isFetching} onQueryChange={(next) => { setQuery(next); setMemberId(""); }} onSelect={(option) => { setQuery(option.label); setMemberId(option.value); }} options={options} placeholder="Start typing a name or email" query={query} />
      <Button className="w-full" disabled={!memberId || assign.isPending} onClick={() => assign.mutate()}>{assign.isPending ? "Assigning…" : "Assign position"}</Button>
    </div>
  </AppDialog>;
}

function ChangeHistory({ entries, positions }: { entries: OrgHistoryEntry[]; positions: OrgPosition[] }) {
  const titles = new Map(positions.map((position) => [position.slug, position.title]));
  return <Card className="bg-surface">
    <CardHeader><div><CardTitle>Change history</CardTitle><CardDescription>Assignments, removals, and resignations in the positions you manage.</CardDescription></div></CardHeader>
    {entries.length ? <ul className="divide-y divide-border text-sm">
      {entries.map((entry) => <li className="py-2" key={`${entry.at}-${entry.position}-${entry.member}`}>
        <span className="font-semibold">{entry.actor}</span> {entry.action === "resigned" ? "resigned from" : entry.action === "assigned" ? `assigned ${entry.member} to` : `removed ${entry.member} from`} {titles.get(entry.position) ?? entry.position}
        <span className="ml-2 text-xs text-muted">{new Date(entry.at).toLocaleString()}</span>
      </li>)}
    </ul> : <p className="text-sm text-muted">No changes yet.</p>}
  </Card>;
}

function useChartMutation(run: () => Promise<unknown>, success: string, after?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ORG_CHART_QUERY_KEY }); toast.success(success); after?.(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The change was not saved."),
  });
}
