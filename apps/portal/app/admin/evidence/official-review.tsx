"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { OfficialGoogleConnect, type OfficialViewer } from "../../../components/official-google-connect";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || "";
type Claim = { id: string; memberId: string; kind: string; title: string; sourceUrl: string; source: string; origin: string; submittedText: string | null; status: string };

export function OfficialEvidenceReview() {
  const [viewer, setViewer] = useState<OfficialViewer | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [points, setPoints] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const [actorResponse, claimsResponse] = await Promise.all([
      fetch(`${apiOrigin}/auth/me`, { credentials: "include", cache: "no-store" }),
      fetch(`${apiOrigin}/evidence/pending`, { credentials: "include", cache: "no-store" }),
    ]);
    if (!actorResponse.ok || !claimsResponse.ok) throw new Error("Official officer session is required.");
    setViewer(await actorResponse.json() as OfficialViewer);
    setClaims(await claimsResponse.json() as Claim[]);
  }, []);
  useEffect(() => { void refresh().catch(() => setViewer(null)); }, [refresh]);

  async function decide(claim: Claim, decision: "approve" | "reject") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${apiOrigin}/evidence/${encodeURIComponent(claim.id)}/review`, {
        method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, points: decision === "approve" ? points[claim.id] : null, reason: reasons[claim.id] || "" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "Review failed");
      }
      await refresh();
      setMessage(`${claim.title}: ${decision === "approve" ? "approved" : "rejected"}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Review failed"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-5"><section className="page-hero"><h1 className="text-3xl font-extrabold">Official evidence review</h1><p className="mt-2 text-muted">Only a different officer can approve a pending claim. Points enter the organization ledger after review.</p></section>
    {!viewer ? <Card className="bg-surface"><p className="mb-3 text-sm">Connect an approved officer account.</p><OfficialGoogleConnect onConnected={() => void refresh().catch((error: Error) => setMessage(error.message))} onError={setMessage} /></Card> : <>
      <Button onClick={() => void refresh().catch((error: Error) => setMessage(error.message))} type="button" variant="secondary">Refresh pending claims</Button>
      {claims.map((claim) => <Card className="space-y-3 bg-surface" key={claim.id}><div><p className="text-xs text-muted">{claim.kind.replaceAll("_", " ")} · {claim.source} · {claim.origin.replaceAll("_", " ")} · member {claim.memberId}</p><h2 className="font-semibold">{claim.title}</h2><a className="text-sm text-accent underline" href={claim.sourceUrl} rel="noreferrer" target="_blank">Open source evidence</a>{claim.submittedText && <p className="mt-2 whitespace-pre-wrap rounded border border-border p-2 text-sm">{claim.submittedText}</p>}</div><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor={`points-${claim.id}`}>Verified points (1–1000)</Label><Input id={`points-${claim.id}`} min={1} max={1000} type="number" value={points[claim.id] ?? ""} onChange={(event) => setPoints((current) => ({ ...current, [claim.id]: Number(event.target.value) }))} /></div><div><Label htmlFor={`reason-${claim.id}`}>Decision reason</Label><Input id={`reason-${claim.id}`} value={reasons[claim.id] || ""} onChange={(event) => setReasons((current) => ({ ...current, [claim.id]: event.target.value }))} /></div></div><div className="flex gap-2"><Button disabled={busy || claim.memberId === viewer.id || !Number.isSafeInteger(points[claim.id]) || points[claim.id] < 1 || points[claim.id] > 1000 || (reasons[claim.id] || "").trim().length < 4} onClick={() => void decide(claim, "approve")} type="button">Approve</Button><Button disabled={busy || claim.memberId === viewer.id || (reasons[claim.id] || "").trim().length < 4} onClick={() => void decide(claim, "reject")} type="button" variant="secondary">Reject</Button></div></Card>)}
      {claims.length === 0 && <Card className="bg-surface">No pending official claims.</Card>}
    </>}
    {message && <p aria-live="polite" className="text-sm text-muted">{message}</p>}
  </div>;
}
