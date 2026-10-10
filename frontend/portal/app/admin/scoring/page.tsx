"use client";

import { useEffect, useState } from "react";

const origin = process.env.NEXT_PUBLIC_API_ORIGIN || "";
type Skill = { slug: string; label: string };
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

export default function ScoringPage() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [queue, setQueue] = useState<Comparison[]>([]);
  const [skill, setSkill] = useState("");
  const [memberA, setMemberA] = useState("");
  const [memberB, setMemberB] = useState("");
  const [validator, setValidator] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    const [who, available, pending] = await Promise.all([
      request<Viewer>("/auth/me"), request<Skill[]>("/scoring/skills"),
      request<Comparison[]>("/scoring/comparisons/pending"),
    ]);
    setViewer(who);
    setSkills(available);
    setQueue(pending);
    setSkill((current) => current || available[0]?.slug || "");
  }

  useEffect(() => { if (origin) void refresh().catch((error: Error) => setMessage(error.message)); }, []);

  async function act(action: () => Promise<unknown>) {
    try { await action(); await refresh(); setMessage("Saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Request failed"); }
  }

  if (!origin) return <p>Scoring backend unavailable.</p>;
  return <main>
    <h1>Skill comparisons</h1>
    <p>Compare only the achievement evidence shown below. Names and profiles are hidden.</p>
    {viewer?.role === "admin" && <section>
      <h2>Admin setup</h2>
      <label htmlFor="scoring-skill">Skill</label>
      <select id="scoring-skill" value={skill} onChange={(event) => setSkill(event.target.value)}>{skills.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}</select>
      <label htmlFor="scoring-validator">Validator member ID</label>
      <input id="scoring-validator" value={validator} onChange={(event) => setValidator(event.target.value)} />
      <button type="button" onClick={() => void act(() => request("/scoring/validators", { memberId: validator, skillSlug: skill }))}>Assign validator</button>
      <label htmlFor="scoring-a">First member ID</label>
      <input id="scoring-a" value={memberA} onChange={(event) => setMemberA(event.target.value)} />
      <label htmlFor="scoring-b">Second member ID</label>
      <input id="scoring-b" value={memberB} onChange={(event) => setMemberB(event.target.value)} />
      <button type="button" onClick={() => void act(() => request("/scoring/comparisons", { skillSlug: skill, memberA, memberB }))}>Create comparison</button>
    </section>}
    <section><h2>Pending comparisons</h2>
      {queue.length === 0 && <p>Unavailable: no assigned comparisons.</p>}
      {queue.map((comparison) => <article key={comparison.id}>
        <h3>{skills.find((item) => item.slug === comparison.skill)?.label || comparison.skill}</h3>
        {(["a", "b"] as const).map((side) => <section key={side}>
          <h4>Candidate {side.toUpperCase()}</h4>
          <ul>{comparison[side].achievements.map((item, index) => <li key={index}>{item.kind}; place {item.place ?? "—"}; base points {item.basePoints}; {item.date}</li>)}</ul>
        </section>)}
        <button type="button" onClick={() => void act(() => request(`/scoring/comparisons/${comparison.id}/vote`, { outcome: "a" }))}>A is stronger</button>
        <button type="button" onClick={() => void act(() => request(`/scoring/comparisons/${comparison.id}/vote`, { outcome: "draw" }))}>Draw</button>
        <button type="button" onClick={() => void act(() => request(`/scoring/comparisons/${comparison.id}/vote`, { outcome: "b" }))}>B is stronger</button>
      </article>)}
    </section>
    <p role="status">{message}</p>
  </main>;
}
