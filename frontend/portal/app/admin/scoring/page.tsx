"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";

const origin = process.env.NEXT_PUBLIC_API_ORIGIN || "";
type Achievement = { kind: string; place: number | null; basePoints: number; date: string };
type Project = { kind: string; points: number; date: string };
type Candidate = { label: string; achievements: Achievement[]; projects: Project[] };
type Comparison = { id: string; skill: string; season: string; a: Candidate; b: Candidate };
type SkillProgress = { slug: string; label: string; candidates: number; totalPairs: number; scheduled: number; reviewed: number };
type SeasonProgress = { season: string; cutoff: string; skills: SkillProgress[] };
type ReviewRequired = { id: string; skill: string; tasks: number };
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

// Mental model: the server freezes each quarter's evidence and assigns pairs and validators;
// officers only review anonymous evidence and aggregate completion.
function SkillComparisonContent() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [progress, setProgress] = useState<SeasonProgress | null>(null);
  const [queue, setQueue] = useState<Comparison[]>([]);
  const [reviewRequired, setReviewRequired] = useState<ReviewRequired[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const who = await request<Viewer>("/auth/me");
    setViewer(who);
    if (who.role !== "officer" && who.role !== "admin") return;
    const [season, pending, review] = await Promise.all([
      request<SeasonProgress>("/scoring/progress"), request<Comparison[]>("/scoring/comparisons/pending"),
      who.role === "admin" ? request<ReviewRequired[]>("/scoring/comparisons/review-required") : Promise.resolve([]),
    ]);
    setProgress(season);
    setQueue(pending);
    setReviewRequired(review);
  }

  useEffect(() => { if (origin) void refresh().catch((error: Error) => setMessage(error.message)); }, []);

  async function vote(id: string, outcome: "a" | "b" | "draw") {
    setBusy(true);
    setMessage("");
    try { await request(`/scoring/comparisons/${id}/vote`, { outcome }); await refresh(); setMessage("Review saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Review failed."); }
    finally { setBusy(false); }
  }

  if (!origin) return null;
  if (!viewer) return <p role="status">{message || "Checking officer access…"}</p>;
  if (viewer.role !== "officer" && viewer.role !== "admin") return null;
  return <div className="space-y-6">
    <section className="page-hero">
      <Badge variant="orange">Quarterly skill validation</Badge>
      <h1 className="mt-3 text-3xl font-extrabold">Blind round robin</h1>
      <p className="mt-2 max-w-2xl text-muted">Automatic per-skill pairs use the last completed quarter's frozen, verified evidence. New or pending evidence enters a later snapshot.</p>
      {progress && <p className="mt-2 text-sm font-semibold">Season {progress.season} · evidence frozen {new Date(progress.cutoff).toLocaleDateString()}</p>}
    </section>
    <section aria-label="Round-robin progress" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {progress?.skills.map((item) => <Card className="bg-surface" key={item.slug}>
        <h2 className="font-semibold">{item.label}</h2>
        <p className="mt-1 text-xs text-muted">{item.candidates} candidates · {item.totalPairs} unique pairs</p>
        <div aria-label={`${item.label} scheduled pairs`} aria-valuemax={item.totalPairs || 1} aria-valuemin={0} aria-valuenow={item.scheduled} className="mt-3 h-2 overflow-hidden rounded-full bg-elevated" role="progressbar"><div className="h-full bg-accent" style={{ width: `${item.totalPairs ? Math.min(100, item.scheduled / item.totalPairs * 100) : 0}%` }} /></div>
        <p className="mt-2 text-xs text-muted">{item.scheduled} scheduled · {item.reviewed} fully reviewed</p>
      </Card>)}
      {progress?.skills.length === 0 && <Card className="bg-surface"><p>No verified skill cohort in this frozen quarter yet.</p></Card>}
    </section>
    {viewer.role === "admin" && reviewRequired.length > 0 && <Card className="space-y-2 bg-surface" role="alert"><h2 className="font-semibold">Reviews needing attention</h2><ul className="list-disc pl-5 text-sm">{reviewRequired.map((item) => <li key={item.id}>{item.skill} · comparison {item.id} · {item.tasks} task(s)</li>)}</ul></Card>}
    <section className="space-y-4"><h2 className="text-xl font-semibold">Assigned comparisons</h2>
      {queue.length === 0 && <Card className="bg-surface"><p className="text-muted">Walang assigned comparison ngayon.</p></Card>}
      {queue.map((comparison) => <Card className="space-y-4 bg-surface" key={comparison.id}>
        <h3 className="font-semibold">{progress?.skills.find((item) => item.slug === comparison.skill)?.label || comparison.skill} · {comparison.season}</h3>
        <div className="grid gap-4 md:grid-cols-2">{(["a", "b"] as const).map((side) => <section className="rounded-md border border-border p-4" key={side}>
          <h4 className="font-mono font-semibold">Candidate {side.toUpperCase()} · {comparison[side].label}</h4>
          <h5 className="mt-3 text-xs font-semibold uppercase text-muted">Verified achievements</h5>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{comparison[side].achievements.map((item, index) => <li key={index}>{item.kind} · place {item.place ?? "—"} · {item.basePoints} base points · {item.date}</li>)}</ul>
          <h5 className="mt-3 text-xs font-semibold uppercase text-muted">Approved projects</h5>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{comparison[side].projects?.map((item, index) => <li key={index}>{item.kind} · {item.points} verified points · {item.date}</li>)}</ul>
        </section>)}</div>
        <div aria-label="Comparison decision" className="flex flex-wrap gap-2" role="group">
          <Button disabled={busy} onClick={() => void vote(comparison.id, "a")} type="button">A is stronger</Button>
          <Button disabled={busy} onClick={() => void vote(comparison.id, "draw")} type="button" variant="secondary">Draw</Button>
          <Button disabled={busy} onClick={() => void vote(comparison.id, "b")} type="button">B is stronger</Button>
        </div>
      </Card>)}
    </section>
    <p role="status">{message}</p>
  </div>;
}

export default function ScoringPage() { return <AppShell><SkillComparisonContent /></AppShell>; }
