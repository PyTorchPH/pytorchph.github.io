"use client";

import { useEffect, useState } from "react";
import { ProductWorkspace } from "@pytorch-ph/domain-client/career-evidence";
import { Card } from "@pytorch-ph/design-system/card";
import { Button } from "@pytorch-ph/design-system/button";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { OfficialGoogleConnect, type OfficialViewer } from "../../../components/official-google-connect";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || "";

export default function Page() {
  const [viewer, setViewer] = useState<OfficialViewer | null>(null);
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [kind, setKind] = useState("personal_project");
  const [claims, setClaims] = useState<Array<{ id: string; title: string; status: string }>>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!apiOrigin) return;
    void fetch(`${apiOrigin}/auth/me`, { credentials: "include", cache: "no-store" })
      .then(async (response) => { if (response.ok) { setViewer(await response.json() as OfficialViewer); void refreshClaims(); } })
      .catch(() => setMessage("Official member session is unavailable."));
  }, []);
  async function refreshClaims() {
    const response = await fetch(`${apiOrigin}/evidence/me`, { credentials: "include", cache: "no-store" });
    if (response.ok) setClaims(await response.json() as typeof claims);
  }
  async function submitEvidence(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setMessage("");
    try {
      const contentHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}\n${title}\n${sourceUrl}`)))).map(byte => byte.toString(16).padStart(2, "0")).join("");
      const response = await fetch(`${apiOrigin}/evidence`, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, title, sourceUrl, contentHash }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || `Submission failed (${response.status})`); }
      setTitle(""); setSourceUrl(""); setMessage("Evidence saved for officer review.");
      await refreshClaims();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Submission failed."); }
    finally { setSaving(false); }
  }
  return <>
    {apiOrigin && <Card className="mx-auto mb-4 max-w-7xl bg-surface"><h2 className="font-semibold">Official evidence account</h2><p className="mt-1 text-sm text-muted">Connect your approved Google account before submitting reviewed extension evidence to the organization ledger.</p>
      {viewer ? <p className="mt-2 text-sm">{viewer.display_name} · {viewer.role === "pending" ? "Awaiting member approval" : "Connected"}</p> : <div className="mt-3"><OfficialGoogleConnect onConnected={setViewer} onError={setMessage} /></div>}
      {message && <p aria-live="polite" className="mt-2 text-sm text-warning">{message}</p>}
    </Card>}
    {apiOrigin && viewer && viewer.role !== "pending" && <Card className="mx-auto mb-4 max-w-7xl bg-surface"><h2 className="font-semibold">Submit official evidence</h2><form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submitEvidence}><div><Label htmlFor="official-evidence-title">Title</Label><Input id="official-evidence-title" minLength={3} maxLength={200} onChange={event => setTitle(event.target.value)} required value={title} /></div><div><Label htmlFor="official-evidence-kind">Kind</Label><select className="w-full border border-border bg-canvas p-2" id="official-evidence-kind" onChange={event => setKind(event.target.value)} value={kind}><option value="personal_project">Personal project</option><option value="external_talk">External talk</option><option value="external_competition">External competition</option><option value="external_participation">External participation</option></select></div><div className="sm:col-span-2"><Label htmlFor="official-evidence-url">Public source URL</Label><Input id="official-evidence-url" onChange={event => setSourceUrl(event.target.value)} required type="url" value={sourceUrl} /></div><Button disabled={saving} type="submit">{saving ? "Saving…" : "Submit for review"}</Button></form><div className="mt-5"><h3 className="font-medium">Saved claims</h3>{claims.length ? <ul className="mt-2 space-y-1 text-sm">{claims.map(claim => <li key={claim.id}>{claim.title} · {claim.status}</li>)}</ul> : <p className="mt-2 text-sm text-muted">No claims yet.</p>}</div></Card>}
    <ProductWorkspace capabilityKey="evidence_read" view="career-evidence" safety="All sources pass through the retrieval middleman; generated displays never overwrite source evidence." />
  </>;
}
