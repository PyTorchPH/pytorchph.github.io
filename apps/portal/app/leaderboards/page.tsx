"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Medal, ShieldCheck, Trophy } from "lucide-react";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { RankingGuide } from "@pytorch-ph/domain-client/leaderboards";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { Progress } from "@pytorch-ph/design-system/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@pytorch-ph/design-system/table";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import { rankForPoints, type LeaderboardPayload, type LeaderboardView } from "@pytorch-ph/domain-protocol/leaderboards";

const subscribeToLocation = () => () => undefined;
// A profile QR code opens this page with ?member=<leaderboard name>.
const readHighlightedMember = () => new URLSearchParams(window.location.search).get("member");

function countdown(endsAt?: string) {
  if (!endsAt) return "—";
  const days = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
  return `${days} day${days === 1 ? "" : "s"} remaining`;
}

export default function LeaderboardsPage() {
  const [skill, setSkill] = useState("");
  const [season, setSeason] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<LeaderboardView>("both");
  const params = useMemo(() => new URLSearchParams({ page: String(page), pageSize: "25", view, ...(skill ? { skill } : {}), ...(season ? { season } : {}) }), [page, season, skill, view]);
  const query = useQuery({ queryKey: ["member-leaderboard", season, skill, view, page], queryFn: () => fetchJson<LeaderboardPayload>(`/api/member/leaderboard?${params}`, { cache: "no-store" }) });
  const data = query.data;
  const highlighted = useSyncExternalStore(subscribeToLocation, readHighlightedMember, () => null);
  const highlightedEntry = highlighted ? data?.entries.find((entry) => entry.displayLabel === highlighted) : undefined;
  const current = data?.entries.find((entry) => entry.isCurrentUser);
  const range = current ? rankForPoints(current.points) : null;
  const progress = range ? range.ceiling ? ((current!.points - range.floor) / (range.ceiling - range.floor)) * 100 : 100 : 0;
  return <AppShell>
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-surface p-5 lg:p-7" data-tour="leaderboards-heading">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><Badge className="text-accent" variant="orange">Members-only competitive ladder</Badge><h1 className="mt-4 text-3xl font-extrabold tracking-[-0.02em]">Season rankings</h1><p className="mt-2 max-w-2xl text-muted">Every member can see every rank. Ranks come from points earned through verified activity; private career data never appears here.</p></div><div className="flex flex-wrap items-center gap-2"><RankingGuide /><Badge variant={data?.meta.mode === "local_demo" ? "warning" : "success"}>{data?.meta.label || "Loading verified ladder"}</Badge></div></div>
        <div className="mt-5 flex flex-wrap gap-3"><label className="text-sm"><span className="mr-2 text-muted">Season</span><select className="rounded-md border border-border bg-elevated px-3 py-2" onChange={(event) => { setSeason(event.target.value); setPage(1); }} value={season}><option value="">Current season</option>{data?.seasons.map((item) => <option key={item.slug} value={item.slug}>{item.label}{item.state === "completed" ? " · Archive" : ""}</option>)}</select></label><label className="text-sm"><span className="mr-2 text-muted">All skills</span><select className="rounded-md border border-border bg-elevated px-3 py-2" onChange={(event) => { setSkill(event.target.value); setPage(1); }} value={skill}><option value="">Global</option>{data?.skills.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}</select></label></div>
        <div aria-label="Evidence verification view" className="mt-4 flex flex-wrap gap-2" role="group">{(["both","verified","pending"] as const).map((item) => <button aria-pressed={view===item} className={`rounded-full border px-4 py-2 text-sm font-semibold ${view===item ? "border-success bg-success/10 text-success" : "border-border text-muted"}`} key={item} onClick={() => { setView(item); setPage(1); }} type="button">{item === "both" ? "Verified + pending" : item[0].toUpperCase()+item.slice(1)}</button>)}</div>
        <div aria-label="Featured ladder tabs" className="mt-4 flex flex-wrap gap-2" data-tour="leaderboards-tabs" role="group">{[{ slug:"",label:"Global" },...(data?.skills.slice(0,4) || [])].map((item) => <button aria-pressed={skill===item.slug} className={`rounded-full border px-4 py-2 text-sm font-semibold ${skill===item.slug ? "border-accent bg-accentSoft text-accent" : "border-border text-muted"}`} key={item.slug || "global"} onClick={() => { setSkill(item.slug); setPage(1); }} type="button">{item.label}</button>)}</div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="bg-surface"><div className="flex items-center gap-2 text-muted"><Trophy size={18} /> Your standing</div><p className="mt-4 text-3xl font-bold">{current ? `${current.points.toLocaleString()} points` : "Not listed"}</p><p className="mt-1 text-sm text-muted">{current ? `${current.verifiedPoints.toLocaleString()} verified · ${current.pendingPoints.toLocaleString()} pending` : "No points in this verification view."}</p></Card>
        <Card className="bg-surface"><div className="flex items-center gap-2 text-muted"><Medal size={18} /> Tier progress</div><div className="mt-4 flex items-center justify-between"><strong>{current ? `${current.tier} ${current.division}` : "Unranked"}</strong><span className="text-xs text-muted">{range?.ceiling ? `${range.ceiling - current!.points} to next` : current ? "Top tier" : "—"}</span></div><Progress className="mt-3" value={progress} /></Card>
        <Card className="bg-surface"><div className="flex items-center gap-2 text-muted"><Clock3 size={18} /> Season clock</div><p className="mt-4 text-xl font-bold">{data?.season.state === "completed" ? "Archived · read only" : countdown(data?.season.endsAt)}</p><p className="mt-1 text-sm text-muted">Asia/Manila quarterly boundary</p></Card>
      </section>

      {highlighted && data && <p className="border border-info/30 bg-info/10 p-3 text-sm" role="status">{highlightedEntry ? `${highlighted} is ranked #${highlightedEntry.rank} with ${highlightedEntry.points.toLocaleString()} points (${highlightedEntry.tier} ${highlightedEntry.division}).` : `${highlighted} is not on this page of the leaderboard.`}</p>}

      <Card className="overflow-hidden bg-surface p-0" data-tour="leaderboards-table">
        <div className="flex items-center justify-between border-b border-border p-4"><div><h2 className="font-bold">{skill ? "Skill point view" : "Global point view"}</h2><p className="mt-1 text-xs text-muted">Points descending · ties are peers · stable pagination does not imply a higher rank</p></div><ShieldCheck className="text-success" /></div>
        {query.isError ? <div className="p-8 text-center"><p className="font-semibold">Leaderboard unavailable</p><p className="mt-2 text-sm text-muted">Live mode does not substitute synthetic rankings.</p></div> :
        <div className="overflow-x-auto"><Table className="min-w-[780px]"><TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Tier</TableHead><TableHead>Points</TableHead><TableHead>Verified</TableHead><TableHead>Pending</TableHead><TableHead>Top verified skills</TableHead></TableRow></TableHeader><TableBody>{data?.entries.map((row) => <TableRow className={row.displayLabel === highlighted && !row.isCurrentUser ? "bg-info/10 outline outline-2 -outline-offset-2 outline-info" : row.isCurrentUser ? "border-y-2 border-accent bg-[linear-gradient(90deg,rgb(var(--accent-rgb)/.1),rgb(var(--accent-rgb)/.1))] shadow-[inset_5px_0_0_rgb(var(--accent-rgb))]" : ""} data-current-user={row.isCurrentUser || undefined} data-highlighted={row.displayLabel === highlighted || undefined} key={`${row.displayLabel}-${row.points}`}><TableCell className="font-semibold">{row.displayLabel}{row.isCurrentUser && <Badge className="ml-2 shadow-lg shadow-accent/30" variant="orange">You</Badge>}</TableCell><TableCell>{row.tier} {row.division}</TableCell><TableCell className="font-mono">{row.points.toLocaleString()}</TableCell><TableCell className="font-mono">{row.verifiedPoints.toLocaleString()}</TableCell><TableCell className="font-mono">{row.pendingPoints.toLocaleString()}</TableCell><TableCell><div className="flex flex-wrap gap-1">{row.verifiedSkills.slice(0,5).map((item) => <Badge key={item}>{item}</Badge>)}</div></TableCell></TableRow>)}{data?.entries.length === 0 && <TableRow><TableCell className="py-10 text-center text-muted" colSpan={6}>No points for this verification view and season.</TableCell></TableRow>}</TableBody></Table></div>}
        <div className="flex items-center justify-between border-t border-border p-4 text-sm text-muted"><span>{data ? `${data.total} ranked members` : "Loading…"}</span><div className="flex gap-2"><Button disabled={page===1} onClick={() => setPage((value) => Math.max(1,value-1))} size="sm" variant="outline">Previous</Button><Button disabled={!data || page*data.pageSize>=data.total} onClick={() => setPage((value) => value+1)} size="sm" variant="outline">Next</Button></div></div>
      </Card>
    </div>
  </AppShell>;
}
