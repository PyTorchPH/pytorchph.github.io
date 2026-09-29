"use client";

// Leaderboard eligibility notice for a member with an active integrity sanction.
// Module map (caller-first):
//   MemberIntegrityNotice  loads active sanctions and shows the newest one
//   AppealForm             opens one appeal with a note
//   loadIntegrityCases     GET /api/evidence/integrity
//   openAppeal             POST /api/evidence/integrity
//   isAppealOpen           the newest appeal is still waiting for an officer

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { Label } from "@pytorch-ph/design-system/input";
import { Textarea } from "@pytorch-ph/design-system/textarea";
import type { EvidenceIntegrityCase } from "@pytorch-ph/domain-protocol/organization";

const MIN_APPEAL_NOTE = 10;

// Mental model: nothing renders without a sanction; with one, show why and let the member appeal once.
export function MemberIntegrityNotice() {
  const [cases, setCases] = useState<EvidenceIntegrityCase[]>([]);
  const load = () => loadIntegrityCases().then(setCases).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  if (!cases.length) return null;
  const active = cases[0];
  return <Card className="border-warning/30 bg-warning/10"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 text-warning"/><div className="flex-1"><h2 className="font-bold">Leaderboard eligibility review</h2><p className="mt-2 text-sm leading-6 text-muted">{active.reason}</p><p className="mt-1 text-xs text-muted">Decision {new Date(active.imposedAt).toLocaleString()} · claim {active.claimId}</p><AppealForm active={active} onOpened={load} /></div></div></Card>;
}

// Mental model: an open appeal replaces the form; otherwise a note of at least ten characters opens one.
function AppealForm({ active, onOpened }: { active: EvidenceIntegrityCase; onOpened: () => Promise<unknown> }) {
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setNotice("");
    try {
      await openAppeal(active.sanctionId, note);
      setNote("");
      setNotice("Appeal opened for officer review.");
      await onOpened();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Appeal could not be opened.");
    } finally {
      setBusy(false);
    }
  };
  return <>{isAppealOpen(active) ? <p className="mt-4 rounded-lg border border-border bg-surface p-3 text-sm">Your appeal is open. An officer must review it before eligibility can change.</p> : <div className="mt-4"><Label htmlFor="integrity-appeal">Appeal note</Label><Textarea id="integrity-appeal" maxLength={1200} onChange={(event) => setNote(event.target.value)} placeholder="Explain which submitted source supports a review." value={note}/><Button className="mt-3" disabled={busy || note.trim().length < MIN_APPEAL_NOTE} onClick={submit}>Open one appeal</Button></div>}{notice && <p aria-live="polite" className="mt-3 text-sm">{notice}</p>}</>;
}

function loadIntegrityCases(): Promise<EvidenceIntegrityCase[]> {
  return fetch("/api/evidence/integrity", { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<EvidenceIntegrityCase[]> : []);
}

async function openAppeal(sanctionId: string, note: string) {
  const response = await fetch("/api/evidence/integrity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sanctionId, note }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Appeal could not be opened.");
}

const isAppealOpen = (active: EvidenceIntegrityCase) => active.appeal?.state === "open";
