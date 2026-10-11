"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";

const origin = process.env.NEXT_PUBLIC_API_ORIGIN || "";
type Skill = { slug: string; label: string };
type Member = { id: string; displayName: string; role: string };
type Achievement = { kind: string; place: number | null; basePoints: number; date: string };
type Comparison = { id: string; skill: string; a: { achievements: Achievement[] }; b: { achievements: Achievement[] } };
type Viewer = { role: string };

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    credentials: "include", cache: "no-store", method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || `HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function SkillComparisonContent() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [queue, setQueue] = useState<Comparison[]>([]);
  const [skill, setSkill] = useState("");
  const [memberA, setMemberA] = useState("");
  const [memberB, setMemberB] = useState("");
  const [validator, setValidator] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const who = await request<Viewer>("/auth/me");
    const [available, pending, approved] = await Promise.all([
      request<Skill[]>("/scoring/skills"), request<Comparison[]>("/scoring/comparisons/pending"),
      who.role === "admin" ? request<Member[]>("/members") : Promise.resolve([]),
    ]);
    setViewer(who);
    setSkills(available);
    setQueue(pending);
    setMembers(approved.filter((member) => member.role !== "pending"));
    setSkill((current) => current || available[0]?.slug || "");
  }

  useEffect(() => { if (origin) void refresh().catch((error: Error) => setMessage(error.message)); }, []);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try { await action(); await refresh(); setMessage("Saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Request failed"); }
    finally { setBusy(false); }
  }

  if (!origin) return <p role="status">Scoring backend unavailable.</p>;
  return <div className="space-y-6">
    <section className="page-hero">
      <Badge variant="orange">Skill validation</Badge>
      <h1 className="mt-3 text-3xl font-extrabold">Blind skill comparisons</h1>
      <p className="mt-2 max-w-2xl text-muted">Compare the achievements for one skill. Candidate names, profiles, and identifiers are hidden in each review.</p>
    </section>
    {!viewer && <Card className="bg-surface"><p>Sign in to view assigned comparisons.</p><Link className="text-accent underline" href="/login/">Go to sign in</Link></Card>}
    {viewer?.role === "admin" && <Card className="space-y-4 bg-surface">
      <div><h2 className="text-xl font-semibold">Admin setup</h2><p className="text-sm text-muted">Assign a vetted validator, then create a pair within the chosen skill.</p></div>
      <div><label className="block text-sm font-medium" htmlFor="scoring-skill">Skill</label><select className="mt-1 w-full rounded-md border border-border bg-elevated p-2" id="scoring-skill" value={skill} onChange={(event) => setSkill(event.target.value)}>{skills.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}</select></div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <div><label className="block text-sm font-medium" htmlFor="scoring-validator">Validator</label><select className="mt-1 w-full rounded-md border border-border bg-elevated p-2" id="scoring-validator" value={validator} onChange={(event) => setValidator(event.target.value)}><option value="">Select a member</option>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName} ({member.role})</option>)}</select></div>
        <Button disabled={busy || !skill || !validator} onClick={() => void act(() => request("/scoring/validators", { memberId: validator, skillSlug: skill }))} type="button">Assign validator</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div><label className="block text-sm font-medium" htmlFor="scoring-a">First candidate</label><select className="mt-1 w-full rounded-md border border-border bg-elevated p-2" id="scoring-a" value={memberA} onChange={(event) => setMemberA(event.target.value)}><option value="">Select a member</option>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></div>
        <div><label className="block text-sm font-medium" htmlFor="scoring-b">Second candidate</label><select className="mt-1 w-full rounded-md border border-border bg-elevated p-2" id="scoring-b" value={memberB} onChange={(event) => setMemberB(event.target.value)}><option value="">Select a member</option>{members.filter((member) => member.id !== memberA).map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></div>
        <Button disabled={busy || !skill || !memberA || !memberB || memberA === memberB} onClick={() => void act(() => request("/scoring/comparisons", { skillSlug: skill, memberA, memberB }))} type="button" variant="secondary">Create comparison</Button>
      </div>
    </Card>}
    {viewer && <section className="space-y-4"><h2 className="text-xl font-semibold">Assigned comparisons</h2>
      {queue.length === 0 && <Card className="bg-surface"><p className="text-muted">Walang assigned comparison ngayon.</p></Card>}
      {queue.map((comparison) => <Card className="space-y-4 bg-surface" key={comparison.id}>
        <h3 className="font-semibold">{skills.find((item) => item.slug === comparison.skill)?.label || comparison.skill}</h3>
        <div className="grid gap-4 md:grid-cols-2">{(["a", "b"] as const).map((side) => <section className="rounded-md border border-border p-4" key={side}>
          <h4 className="font-semibold">Candidate {side.toUpperCase()}</h4>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{comparison[side].achievements.map((item, index) => <li key={index}>{item.kind} · place {item.place ?? "—"} · {item.basePoints} base points · {item.date}</li>)}</ul>
        </section>)}</div>
        <div aria-label="Comparison decision" className="flex flex-wrap gap-2" role="group">
          <Button disabled={busy} onClick={() => void act(() => request(`/scoring/comparisons/${comparison.id}/vote`, { outcome: "a" }))} type="button">A is stronger</Button>
          <Button disabled={busy} onClick={() => void act(() => request(`/scoring/comparisons/${comparison.id}/vote`, { outcome: "draw" }))} type="button" variant="secondary">Draw</Button>
          <Button disabled={busy} onClick={() => void act(() => request(`/scoring/comparisons/${comparison.id}/vote`, { outcome: "b" }))} type="button">B is stronger</Button>
        </div>
      </Card>)}
    </section>}
    <p role="status">{message}</p>
  </div>;
}

export default function ScoringPage() {
  return <AppShell><SkillComparisonContent /></AppShell>;
}
