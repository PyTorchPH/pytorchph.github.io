"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { Input, Label } from "@pytorch-ph/design-system/input";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || "";
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

type Viewer = { id: string; display_name: string; role: string };
type Member = { id: string; displayName: string; role: string };
type EventItem = { id: string; title: string; category: string; startsAt: string; revision: number; publishedAt: string | null };
type Entrant = { id: string; name: string; kind: string; memberIds: string[] };
type EventDetail = { id: string; title: string; category: string; startsAt: string; competitive: boolean; entrantKind: "team" | "individual" | null; lastPlace: number | null; revision: number; placePoints: [number, number][]; results: [number, string][] };
type GoogleApi = { accounts: { id: { initialize: (config: { client_id: string; callback: (value: { credential: string }) => void }) => void; renderButton: (element: HTMLElement, options: { theme: string; size: string }) => void } } };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiOrigin}${path}`, { credentials: "include", cache: "no-store", ...init });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(error.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function CompetitiveEventForm() {
  const [ready, setReady] = useState(false);
  const googleButton = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selected, setSelected] = useState<EventDetail | null>(null);
  const [entrants, setEntrants] = useState<Entrant[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("hackathon");
  const [parentId, setParentId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [entrantKind, setEntrantKind] = useState<"individual" | "team">("team");
  const [lastPlace, setLastPlace] = useState(3);
  const [pointsCsv, setPointsCsv] = useState("100, 60, 30");
  const [entrantName, setEntrantName] = useState("");
  const [entrantMembers, setEntrantMembers] = useState<string[]>([]);
  const [placements, setPlacements] = useState<string[]>([]);
  const [reason, setReason] = useState("Official judges result");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const [current, approved, allEvents] = await Promise.all([
      api<Viewer>("/auth/me"), api<Member[]>("/members"), api<EventItem[]>("/events"),
    ]);
    setViewer(current);
    setMembers(approved.filter((member) => member.role !== "pending"));
    setEvents(allEvents);
  }, []);

  useEffect(() => {
    if (!apiOrigin) return;
    void refresh().catch(() => setViewer(null));
  }, [refresh]);

  useEffect(() => {
    if (!ready || !googleClientId || !googleButton.current || viewer) return;
    const google = (window as unknown as { google?: GoogleApi }).google;
    if (!google) return;
    google.accounts.id.initialize({ client_id: googleClientId, callback: ({ credential }) => {
      void api<Viewer>("/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id_token: credential }) })
        .then(() => refresh()).catch((error: Error) => setMessage(error.message));
    } });
    google.accounts.id.renderButton(googleButton.current, { theme: "outline", size: "large" });
  }, [ready, refresh, viewer]);

  async function selectEvent(id: string) {
    const [detail, registrations] = await Promise.all([api<EventDetail>(`/events/${id}/results`), api<Entrant[]>(`/events/${id}/entrants`)]);
    setSelected(detail);
    setEntrants(registrations);
    setPlacements(detail.results.map((result) => result[1]));
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Request failed"); }
    finally { setBusy(false); }
  }

  function create() {
    return run(async () => {
      const competitive = !["talk", "workshop"].includes(category);
      const points = pointsCsv.split(",").map((value) => Number(value.trim()));
      if (competitive && (!Number.isSafeInteger(lastPlace) || lastPlace < 1 || points.length !== lastPlace || points.some((value) => !Number.isSafeInteger(value) || value < 0))) {
        throw new Error("Maglagay ng nonnegative whole-number points para sa bawat place hanggang last awarded place.");
      }
      const created = await api<{ id: string }>("/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        title, category, startsAt: new Date(startsAt).toISOString(), entrantKind: competitive ? entrantKind : null, parentId: category === "mini_contest" ? parentId : null, placePoints: competitive ? points : null,
      }) });
      await refresh();
      await selectEvent(created.id);
      setMessage(competitive ? "Event created. Add eligible entrants before publishing results." : "Parent event created. Puwede nang magdagdag ng mini contest.");
    });
  }

  function addEntrant() {
    if (!selected) return;
    return run(async () => {
      await api(`/events/${selected.id}/entrants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: entrantName, memberIds: entrantMembers }) });
      await selectEvent(selected.id);
      setEntrantName("");
      setEntrantMembers([]);
      setMessage("Entrant registered.");
    });
  }

  function publish() {
    if (!selected) return;
    return run(async () => {
      if (placements.some((id) => !id) || new Set(placements).size !== placements.length) throw new Error("Pumili ng magkakaibang registered entrants para sa bawat place.");
      await api(`/events/${selected.id}/results`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        expectedRevision: selected.revision, placements: placements.map((entrantId, index) => ({ place: index + 1, entrantId })), reason,
      }) });
      await selectEvent(selected.id);
      setMessage("Results published; server ang magre-refresh ng leaderboard.");
    });
  }

  if (!apiOrigin || !googleClientId) return <Card className="bg-surface"><p className="text-sm text-muted">Competitive-event backend is not configured for this build.</p></Card>;

  return <Card className="space-y-5 bg-surface">
    <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setReady(true)} />
    <div><h3 className="font-heading text-lg font-semibold">Internal events and competitions</h3><p className="text-sm text-muted">Set placements when creating a competition; select official winners after it starts.</p></div>
    {!viewer ? <div><p className="mb-2 text-sm">Connect your officer Google account to the official backend.</p><div ref={googleButton} /></div> : viewer.role !== "officer" && viewer.role !== "admin" ? <p className="text-sm text-muted">Officer approval is required.</p> : <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="competition-title">Event title</Label><Input id="competition-title" value={title} onChange={(event) => setTitle(event.target.value)} /></div>
        <div><Label htmlFor="competition-category">Category</Label><select className="w-full border border-border bg-canvas p-2" id="competition-category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="talk">Talk</option><option value="workshop">Workshop</option><option value="hackathon">Hackathon</option><option value="competitive">Other competition</option><option value="mini_contest">Talk/workshop mini contest</option></select></div>
        {category === "mini_contest" && <div><Label htmlFor="competition-parent">Parent talk/workshop</Label><select className="w-full border border-border bg-canvas p-2" id="competition-parent" value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Select parent</option>{events.filter((item) => item.category === "talk" || item.category === "workshop").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>}
        <div><Label htmlFor="competition-start">Start date/time</Label><Input id="competition-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></div>
        {!["talk", "workshop"].includes(category) && <><div><Label htmlFor="competition-kind">Entrants</Label><select className="w-full border border-border bg-canvas p-2" id="competition-kind" value={entrantKind} onChange={(event) => setEntrantKind(event.target.value as "individual" | "team")}><option value="team">Teams</option><option value="individual">Individuals</option></select></div>
        <div><Label htmlFor="competition-last-place">Last awarded place</Label><Input id="competition-last-place" min={1} type="number" value={lastPlace} onChange={(event) => setLastPlace(Number(event.target.value))} /></div>
        <div><Label htmlFor="competition-points">Points from 1st place onward (comma-separated)</Label><Input id="competition-points" value={pointsCsv} onChange={(event) => setPointsCsv(event.target.value)} /></div></>}
      </div>
      <Button disabled={busy} onClick={create} type="button">Create competitive event</Button>
      <div><Label htmlFor="competition-existing">Manage event results</Label><select className="w-full border border-border bg-canvas p-2" id="competition-existing" value={selected?.id || ""} onChange={(event) => void selectEvent(event.target.value).catch((error: Error) => setMessage(error.message))}><option value="">Select event</option>{events.filter((item) => ["hackathon", "competitive", "mini_contest"].includes(item.category)).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
      {selected?.competitive && <div className="space-y-4 border-t border-border pt-4">
        <p className="text-sm">{selected.title} · {selected.entrantKind} · up to {selected.lastPlace} places · revision {selected.revision}</p>
        {!selected.results.length && <div className="space-y-2"><Label htmlFor="entrant-name">Entrant/team name</Label><Input id="entrant-name" value={entrantName} onChange={(event) => setEntrantName(event.target.value)} /><div className="grid max-h-40 gap-1 overflow-auto border border-border p-2 sm:grid-cols-2">{members.map((member) => <label className="text-sm" key={member.id}><input checked={entrantMembers.includes(member.id)} onChange={(event) => setEntrantMembers((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} type="checkbox" /> {member.displayName}</label>)}</div><Button disabled={busy} onClick={addEntrant} type="button" variant="secondary">Register entrant</Button></div>}
        <p className="text-sm text-muted">Registered: {entrants.map((item) => item.name).join(", ") || "none"}</p>
        {placements.map((entrantId, index) => <div key={index}><Label htmlFor={`place-${index}`}>{index + 1}{index === 0 ? "st" : index === 1 ? "nd" : index === 2 ? "rd" : "th"} place · {selected.placePoints[index]?.[1] ?? 0} points</Label><select className="w-full border border-border bg-canvas p-2" id={`place-${index}`} value={entrantId} onChange={(event) => setPlacements((current) => current.map((value, i) => i === index ? event.target.value : value))}><option value="">Select registered entrant</option>{entrants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>)}
        <div className="flex gap-2"><Button disabled={placements.length >= Math.min(selected.lastPlace || 0, entrants.length)} onClick={() => setPlacements((current) => [...current, ""])} type="button" variant="secondary">Add next place</Button><Button disabled={!placements.length} onClick={() => setPlacements((current) => current.slice(0, -1))} type="button" variant="secondary">Remove last place</Button></div>
        <div><Label htmlFor="result-reason">Judges result/correction reason</Label><Input id="result-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        <Button disabled={busy || !placements.length} onClick={publish} type="button">{selected.revision ? "Publish corrected results" : "Publish official results"}</Button>
      </div>}
    </>}
    {message && <p aria-live="polite" className="text-sm text-muted">{message}</p>}
  </Card>;
}
