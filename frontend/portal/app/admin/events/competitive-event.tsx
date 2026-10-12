"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { Input, Label } from "@pytorch-ph/design-system/input";
import Link from "next/link";
import { OfficialGoogleConnect, type OfficialViewer } from "../../../components/official-google-connect";
import { allocateSkillTags, SkillTagPicker } from "./skill-tag-picker";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || "";
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

type Viewer = OfficialViewer;
type Member = { id: string; displayName: string; role: string };
type EventItem = { id: string; title: string; category: string; startsAt: string; revision: number; publishedAt: string | null };
type Entrant = { id: string; name: string; kind: string; memberIds: string[] };
type EventDetail = { id: string; title: string; category: string; startsAt: string; competitive: boolean; entrantKind: "team" | "individual" | null; lastPlace: number | null; revision: number; placePoints: [number, number][]; results: [number, string][] };
type AttendanceSummary = { source: null | { formId: string; points: number; lastImportedAt: string | null }; awarded: number; unmatched: number };
type Skill = { slug: string; label: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiOrigin}${path}`, { credentials: "include", cache: "no-store", ...init });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(error.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function CompetitiveEventForm({ mode = "create" }: { mode?: "create" | "results" }) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [eventPermissions, setEventPermissions] = useState({ canCreate: false, canPublish: false });
  const [members, setMembers] = useState<Member[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
const [skills, setSkills] = useState<Skill[]>([]);
const [eventSkills, setEventSkills] = useState<string[]>([]);
const [weight, setWeight] = useState("");
const [weightReason, setWeightReason] = useState("");
const [modelSuggestion, setModelSuggestion] = useState("");
const [modelDetails, setModelDetails] = useState("");
  const [selected, setSelected] = useState<EventDetail | null>(null);
  const [entrants, setEntrants] = useState<Entrant[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("hackathon");
  const [parentId, setParentId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [publicTopic, setPublicTopic] = useState("");
  const [publicDescription, setPublicDescription] = useState("");
  const [publicVenue, setPublicVenue] = useState("");
  const [registrationUrl, setRegistrationUrl] = useState("");
  const [publicSeries, setPublicSeries] = useState("");
  const [entrantKind, setEntrantKind] = useState<"individual" | "team">("team");
  const [lastPlace, setLastPlace] = useState(3);
  const [pointsCsv, setPointsCsv] = useState("");
  const [entrantName, setEntrantName] = useState("");
  const [entrantMembers, setEntrantMembers] = useState<string[]>([]);
  const [placements, setPlacements] = useState<string[]>([]);
  const [reason, setReason] = useState("Official judges result");
  const [formId, setFormId] = useState("");
  const [attendancePoints, setAttendancePoints] = useState(10);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
const [current, approved, allEvents, availableSkills, permissions] = await Promise.all([
  api<Viewer>("/auth/me"), api<Member[]>("/members"), api<EventItem[]>("/events"), api<Skill[]>("/scoring/skills"),
  api<{ canCreate: boolean; canPublish: boolean }>("/events/permissions"),
    ]);
    setViewer(current);
    setMembers(approved.filter((member) => member.role !== "pending"));
    setEvents(allEvents);
    setEventPermissions(permissions);
    if (!permissions.canPublish) setIsPublic(false);
setSkills(availableSkills);
  }, []);

  useEffect(() => {
    if (!apiOrigin) return;
    void refresh().catch(() => setViewer(null));
  }, [refresh]);

  async function selectEvent(id: string) {
    const [detail, registrations, attendanceSummary] = await Promise.all([api<EventDetail>(`/events/${id}/results`), api<Entrant[]>(`/events/${id}/entrants`), api<AttendanceSummary>(`/events/${id}/attendance`)]);
    setSelected(detail);
    setEntrants(registrations);
    setPlacements(detail.results.map((result) => result[1]));
    setAttendance(attendanceSummary);
    setFormId(attendanceSummary.source?.formId || "");
    setAttendancePoints(attendanceSummary.source?.points || 10);
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
      if (!eventPermissions.canCreate) throw new Error("Hindi pinapayagan ng kasalukuyang position ang paggawa ng event.");
      if (isPublic && !eventPermissions.canPublish) throw new Error("Hindi pinapayagan ng kasalukuyang position ang pag-publish ng event.");
      if (isPublic && !publicDescription.trim()) throw new Error("Kailangan ng description bago ipakita ang event sa public website.");
      const points = pointsCsv.trim() ? pointsCsv.split(",").map((value) => Number(value.trim())) : null;
if (eventSkills.length === 0) throw new Error("Pumili ng kahit isang skill tag.");
const skillTags = allocateSkillTags(eventSkills);
const weightMilli = weight.trim() ? Math.round(Number(weight) * 1000) : null;
if (weightMilli !== null && (!Number.isSafeInteger(weightMilli) || weightMilli < 1 || weightMilli > 10000)) throw new Error("Ang weight ay dapat 0.001 hanggang 10.");
      if (competitive && points && (!Number.isSafeInteger(lastPlace) || lastPlace < 1 || points.length !== lastPlace || points.some((value) => !Number.isSafeInteger(value) || value < 0))) {
        throw new Error("Maglagay ng nonnegative whole-number points para sa bawat place hanggang last awarded place.");
      }
      const created = await api<{ id: string }>("/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
title, category, startsAt: new Date(startsAt).toISOString(), entrantKind: competitive ? entrantKind : null, parentId: category === "mini_contest" ? parentId : null, placePoints: competitive ? points : null,
skillTags, weightMilli, weightReason: weightReason || null,
publication: { isPublic, isDemo, topic: publicTopic, description: publicDescription, venue: publicVenue, registrationUrl: isDemo ? "" : registrationUrl, series: publicSeries },
      }) });
      await refresh();
      if (competitive) await selectEvent(created.id);
      setMessage(competitive ? "Event created. Add eligible entrants before publishing results." : "Parent event created. Puwede nang magdagdag ng mini contest.");
    });
  }

  function previewWeight() {
    return run(async () => {
      if (!eventSkills.length) throw new Error("Pumili muna ng skill tag.");
      const skillTags = allocateSkillTags(eventSkills);
      const result = await api<{ status: string; weightMilli?: number; modelVersion?: number; placePoints?: number[]; detailsMarkdown?: string }>("/scoring/suggestion", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, skillTags }),
      });
      setModelSuggestion(result.status === "ready" ? `Model v${result.modelVersion}: ${((result.weightMilli || 0) / 1000).toFixed(3)}× · proposed places: ${result.placePoints?.join(", ") || "none"}.` : "Model suggestion unavailable. Magtakda ng organizer weight, place points, at reason.");
      setModelDetails(result.detailsMarkdown || "");
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

  function importAttendance() {
    if (!selected) return;
    return run(async () => {
      const result = await api<{ fetched: number; awarded: number; unmatched: number; duplicates: number; duplicateMembers: number }>(`/events/${selected.id}/attendance/import`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formId: formId.trim(), points: attendancePoints }),
      });
      const summary = await api<AttendanceSummary>(`/events/${selected.id}/attendance`);
      setAttendance(summary);
      setMessage(`Attendance imported: ${result.awarded} awarded, ${result.unmatched} unmatched, ${result.duplicateMembers} duplicate members, ${result.duplicates} already imported (${result.fetched} fetched).`);
    });
  }

  if (!apiOrigin) return <Card className="bg-surface"><p className="text-sm text-muted">Competitive-event backend is not configured for this build.</p></Card>;

  return <Card className="space-y-5 bg-surface">
    <div><h3 className="font-heading text-lg font-semibold">{mode === "create" ? "Create event" : "Manage event results"}</h3><p className="text-sm text-muted">{mode === "create" ? "Set categories, skill allocations, and proposed place points." : "Register entrants, publish placements, and import attendance."}</p></div>
    {!viewer ? <div><p className="mb-2 text-sm">Sign in with an approved officer account.</p>{googleClientId ? <OfficialGoogleConnect onConnected={() => void refresh().catch((error: Error) => setMessage(error.message))} onError={setMessage} /> : <Link className="text-accent underline" href="/login/">Go to sign in</Link>}</div> : viewer.role !== "officer" && viewer.role !== "admin" ? <p className="text-sm text-muted">Officer approval is required.</p> : <>
      {mode === "create" && !eventPermissions.canCreate && <p className="text-sm text-muted">Walang event-create permission ang kasalukuyang position mo.</p>}
      {mode === "create" && eventPermissions.canCreate && <><div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="competition-title">Event title</Label><Input id="competition-title" value={title} onChange={(event) => setTitle(event.target.value)} /></div>
        <div><Label htmlFor="competition-category">Category</Label><select className="w-full border border-border bg-canvas p-2" id="competition-category" value={category} onChange={(event) => { setCategory(event.target.value); setModelSuggestion(""); setModelDetails(""); }}><option value="talk">Talk</option><option value="workshop">Workshop</option><option value="hackathon">Hackathon</option><option value="competitive">Other competition</option><option value="mini_contest">Talk/workshop mini contest</option></select></div>
        {category === "mini_contest" && <div><Label htmlFor="competition-parent">Parent talk/workshop</Label><select className="w-full border border-border bg-canvas p-2" id="competition-parent" value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Select parent</option>{events.filter((item) => item.category === "talk" || item.category === "workshop").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>}
        <div><Label htmlFor="competition-start">Start date/time</Label><Input id="competition-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></div>
        <div className="space-y-2 sm:col-span-2"><label className="flex items-center gap-2"><input type="checkbox" disabled={!eventPermissions.canPublish} checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />Ipakita sa public website</label><label className="flex items-center gap-2"><input type="checkbox" checked={isDemo} onChange={(event) => { setIsDemo(event.target.checked); if (event.target.checked) setRegistrationUrl(""); }} />Demo/Test event</label><p className="text-xs text-muted">Private ang default. Ang public event ay babasahin mula sa saved record sa susunod na page load o refresh. Walang registration link ang Demo/Test.</p></div>
        <div><Label htmlFor="event-public-topic">Public topic</Label><Input id="event-public-topic" maxLength={500} value={publicTopic} onChange={(event) => setPublicTopic(event.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="event-public-description">Event description {isPublic ? "(required)" : "(draft)"}</Label><textarea id="event-public-description" className="w-full border border-border bg-canvas p-2" rows={5} maxLength={2000} required={isPublic} value={publicDescription} onChange={(event) => setPublicDescription(event.target.value)} /><p className="text-xs text-muted">Ito ang content na ipapakita sa upcoming events. Hanggang 2,000 characters; plain text lang.</p></div>
        <div><Label htmlFor="event-public-venue">Venue/platform</Label><Input id="event-public-venue" maxLength={300} value={publicVenue} onChange={(event) => setPublicVenue(event.target.value)} /></div>
        <div><Label htmlFor="event-registration-url">Registration URL (HTTPS)</Label><Input id="event-registration-url" type="url" maxLength={2000} disabled={isDemo} value={registrationUrl} onChange={(event) => setRegistrationUrl(event.target.value)} /></div>
        <div><Label htmlFor="event-public-series">Program/series</Label><Input id="event-public-series" maxLength={200} value={publicSeries} onChange={(event) => setPublicSeries(event.target.value)} /></div>
        <SkillTagPicker skills={skills} selected={eventSkills} onChange={(selected) => { setEventSkills(selected); setModelSuggestion(""); setModelDetails(""); }} />
        <div><Label htmlFor="event-weight">Organizer weight</Label><Input id="event-weight" type="number" min="0.001" max="10" step="0.001" value={weight} onChange={(event) => setWeight(event.target.value)} /><p className="mt-1 text-xs text-muted">Iwang blangko para sa published model weight. Kung unavailable ang model, kailangan ng organizer weight.</p></div>
        <div><Button disabled={busy || !eventSkills.length} onClick={previewWeight} type="button" variant="secondary">Tingnan ang model suggestion</Button><p className="mt-2 text-sm text-muted" role="status">{modelSuggestion}</p>{modelDetails && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap border border-border bg-elevated p-3 text-xs leading-5">{modelDetails}</pre>}</div>
        {(weight.trim() || pointsCsv.trim()) && <div><Label htmlFor="event-weight-reason">Reason for organizer override</Label><Input id="event-weight-reason" value={weightReason} onChange={(event) => setWeightReason(event.target.value)} /></div>}
        {!["talk", "workshop"].includes(category) && <><div><Label htmlFor="competition-kind">Entrants</Label><select className="w-full border border-border bg-canvas p-2" id="competition-kind" value={entrantKind} onChange={(event) => setEntrantKind(event.target.value as "individual" | "team")}><option value="team">Teams</option><option value="individual">Individuals</option></select></div>
        {pointsCsv.trim() && <div><Label htmlFor="competition-last-place">Last awarded place</Label><Input id="competition-last-place" min={1} type="number" value={lastPlace} onChange={(event) => setLastPlace(Number(event.target.value))} /></div>}
        <div><Label htmlFor="competition-points">Organizer place points (optional override)</Label><Input id="competition-points" placeholder="Blank uses model schedule" value={pointsCsv} onChange={(event) => setPointsCsv(event.target.value)} /></div>
        </>}
      </div>
      <Button disabled={busy} onClick={create} type="button">Create event</Button></>}
      {mode === "results" && <>
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
      {selected && <div className="space-y-3 border-t border-border pt-4">
        <div><h4 className="font-semibold">Google Forms attendance</h4><p className="text-sm text-muted">Only Forms collecting verified signed-in email can award points. Each approved member earns once per event. The form and point value become immutable after the first import.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="attendance-form-id">Form ID</Label><Input disabled={Boolean(attendance?.source)} id="attendance-form-id" value={formId} onChange={(event) => setFormId(event.target.value)} /></div>
          <div><Label htmlFor="attendance-points">Points per matched response</Label><Input disabled={Boolean(attendance?.source)} id="attendance-points" min={1} max={1000} type="number" value={attendancePoints} onChange={(event) => setAttendancePoints(Number(event.target.value))} /></div>
        </div>
        {attendance?.source && <p className="text-sm text-muted">Awarded: {attendance.awarded} · unmatched: {attendance.unmatched} · last import: {attendance.source.lastImportedAt ? new Date(attendance.source.lastImportedAt).toLocaleString() : "never"}</p>}
        <Button disabled={busy || !formId.trim() || !Number.isSafeInteger(attendancePoints) || attendancePoints < 1 || attendancePoints > 1000} onClick={importAttendance} type="button" variant="secondary">Import attendance</Button>
      </div>}</>}
    </>}
    {message && <p aria-live="polite" className="text-sm text-muted">{message}</p>}
  </Card>;
}
